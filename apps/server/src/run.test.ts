import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { writeSettings } from '@deepcode/core/config';
import { afterEach, describe, expect, it } from 'vitest';

import { runAppServer } from './run.js';

let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('runAppServer', () => {
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
