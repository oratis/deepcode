import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';

import { writeSettings } from '@deepcode/core/config';
import { SessionManager } from '@deepcode/core/sessions';
import type { ProtocolMethod, ProtocolResponse, ThreadSnapshot } from '@deepcode/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { runAppServer } from './run.js';

let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('runAppServer', () => {
  it('serves every advertised session-management method through the wire decoder', async () => {
    root = await mkdtemp(join(tmpdir(), 'dc-app-server-wire-'));
    const cwd = join(root, 'workspace');
    await mkdir(cwd);
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = createInterface({ input: output });
    const pending = new Map<number, (response: ProtocolResponse) => void>();
    let sequence = 0;
    lines.on('line', (line) => {
      const response = JSON.parse(line) as ProtocolResponse;
      if (response.id === null) {
        for (const resolve of pending.values()) resolve(response);
        pending.clear();
      } else if (typeof response.id === 'number') {
        pending.get(response.id)?.(response);
        pending.delete(response.id);
      }
    });
    const request = async <T>(method: ProtocolMethod, params: Record<string, unknown> = {}) => {
      const id = ++sequence;
      const response = new Promise<ProtocolResponse>((resolve) => pending.set(id, resolve));
      input.write(`${JSON.stringify({ id, method, params })}\n`);
      const value = await response;
      expect(value.id).toBe(id);
      expect(value.error).toBeUndefined();
      return value.result as T;
    };
    const serving = runAppServer({
      input,
      output,
      home: root,
      executor: { execute: async () => ({}) },
    });
    try {
      const initialized = await request<{
        capabilities: {
          sessionJournal: boolean;
          threadManagement: boolean;
          runtimeCapabilities: boolean;
        };
      }>('initialize');
      expect(initialized.capabilities).toMatchObject({
        sessionJournal: true,
        threadManagement: true,
        runtimeCapabilities: true,
      });
      await request('runtime/capabilities', { cwd });
      const thread = await request<ThreadSnapshot>('thread/start', { cwd });
      const threadId = thread.id;
      await request('thread/rename', { threadId, title: 'Wire journal' });
      expect((await request<ThreadSnapshot>('thread/read', { threadId })).title).toBe(
        'Wire journal',
      );
      const path = join(cwd, 'source.txt');
      await writeFile(path, 'before');
      await new SessionManager({ root: join(root, 'sessions') }).snapshot({
        sessionId: threadId,
        cwd,
        filePath: path,
        reason: 'pre-Edit',
        seq: 1,
      });
      expect(await request('session/snapshots', { threadId, path })).toMatchObject([
        { seq: 1, content: 'before' },
      ]);
      const firstFork = await request<ThreadSnapshot>('thread/fork', { threadId });
      await request('thread/delete', { threadId: firstFork.id });
      const secondFork = await request<ThreadSnapshot>('thread/fork', { threadId });
      await request('thread/archive', { threadId: secondFork.id });
      const listed = await request<{ threads: { id: string }[] }>('thread/list');
      expect(listed.threads.map((item) => item.id)).toEqual([threadId]);
    } finally {
      input.end();
      await serving;
      lines.close();
    }
  });

  it('wires trust-aware configuration diagnostics through stdio', async () => {
    root = await mkdtemp(join(tmpdir(), 'dc-app-server-'));
    const cwd = join(root, 'workspace');
    await writeSettings(join(cwd, '.deepcode', 'settings.json'), {
      permissions: { allow: ['Bash'] },
    });
    const input = new PassThrough();
    const output = new PassThrough();
    let raw = '';
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => {
      raw += chunk;
    });

    input.end(
      `${JSON.stringify({ id: 1, method: 'initialize', params: {} })}\n` +
        `${JSON.stringify({ id: 2, method: 'config/diagnostics', params: { cwd } })}\n` +
        `${JSON.stringify({ id: 3, method: 'diagnostics/export', params: { cwd } })}\n`,
    );
    await runAppServer({
      input,
      output,
      home: root,
      executor: { execute: async () => ({}) },
    });

    const responses = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: number; result: Record<string, unknown> });
    expect(responses[0]?.result).toEqual(
      expect.objectContaining({
        capabilities: expect.objectContaining({ configDiagnostics: true }),
      }),
    );
    expect(responses[1]).toEqual(
      expect.objectContaining({
        id: 2,
        result: expect.objectContaining({
          cwd,
          trustStatus: 'untrusted',
          gated: ['permissions'],
        }),
      }),
    );
    const exported = responses[2]?.result as { path: string; recordCount: number };
    expect(exported.recordCount).toBeGreaterThan(0);
    const bundle = await readFile(exported.path, 'utf8');
    expect(bundle).toContain('protocol.request.completed');
    expect(bundle).not.toContain(cwd);
  });
});
