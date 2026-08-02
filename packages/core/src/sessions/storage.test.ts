import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendMessage,
  listSessions,
  newSessionId,
  readMessages,
  readMeta,
  readSessionRecords,
  SessionCorruptionError,
  SessionWriterConflictError,
  sessionFiles,
  writeMeta,
} from './storage.js';
import type { StoredMessage } from '../types.js';

describe('session storage', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dc-sessions-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('newSessionId is unique enough', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newSessionId()));
    expect(ids.size).toBe(100);
  });

  it('writeMeta + readMeta round-trip', async () => {
    const id = newSessionId();
    const now = new Date().toISOString();
    await writeMeta(root, {
      id,
      cwd: '/x',
      createdAt: now,
      updatedAt: now,
      model: 'deepseek-chat',
    });
    const meta = await readMeta(root, id);
    expect(meta?.id).toBe(id);
    expect(meta?.cwd).toBe('/x');
    expect(meta?.model).toBe('deepseek-chat');
  });

  it('appendMessage produces jsonl readable by readMessages', async () => {
    const id = newSessionId();
    await writeMeta(root, {
      id,
      cwd: '/x',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    const msgs: StoredMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ];
    for (const m of msgs) await appendMessage(root, id, m);
    const got = await readMessages(root, id);
    expect(got).toHaveLength(2);
    expect(got[0]?.role).toBe('user');
    expect(got[1]?.role).toBe('assistant');
    if (got[0]?.content[0]?.type === 'text') expect(got[0].content[0].text).toBe('hello');
    const records = (await readFile(sessionFiles(root, id).jsonlPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records[0]).toMatchObject({ type: 'session_meta', schema_version: 1, id });
    expect(records.slice(1)).toEqual([
      expect.objectContaining({ type: 'message', schema_version: 1, role: 'user' }),
      expect.objectContaining({ type: 'message', schema_version: 1, role: 'assistant' }),
    ]);
  });

  it('readMessages returns [] when jsonl missing', async () => {
    expect(await readMessages(root, 'nope')).toEqual([]);
  });

  it('reads desktop header + typed message JSONL without changing its bytes', async () => {
    const id = 'desktop-old';
    const path = sessionFiles(root, id).legacyJsonlPath;
    const original = [
      JSON.stringify({
        type: 'session_meta',
        id,
        cwd: '/desktop',
        created_at: 1_767_225_600,
        title: 'Legacy desktop',
      }),
      JSON.stringify({
        type: 'message',
        role: 'user',
        content: [{ type: 'text', text: 'hello from desktop' }],
        timestamp: '2026-01-01T00:00:01.000Z',
      }),
      '',
    ].join('\n');
    await writeFile(path, original, 'utf8');

    const parsed = await readSessionRecords(root, id);
    expect(parsed.format).toBe('desktop-v0');
    expect(parsed.meta).toMatchObject({ id, cwd: '/desktop', title: 'Legacy desktop' });
    expect(parsed.messages).toHaveLength(1);
    expect(await readFile(path, 'utf8')).toBe(original);
    await expect(readMeta(root, id)).resolves.toMatchObject({ id, cwd: '/desktop' });
  });

  it('tolerates only an incomplete final JSONL record', async () => {
    const id = 'truncated-tail';
    await writeFile(
      sessionFiles(root, id).legacyJsonlPath,
      `${JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'complete' }] })}\n{"role":"assistant"`,
      'utf8',
    );

    const parsed = await readSessionRecords(root, id);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ line: 2, code: 'truncated_tail', fatal: false }),
    ]);
    await expect(readMessages(root, id)).resolves.toHaveLength(1);
  });

  it('reports middle corruption instead of silently dropping history', async () => {
    const id = 'middle-corrupt';
    await writeFile(
      sessionFiles(root, id).legacyJsonlPath,
      [
        JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'before' }] }),
        '{not-json}',
        JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'after' }] }),
        '',
      ].join('\n'),
      'utf8',
    );

    const parsed = await readSessionRecords(root, id);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ line: 2, code: 'invalid_json', fatal: true }),
    ]);
    await expect(readMessages(root, id)).rejects.toBeInstanceOf(SessionCorruptionError);
  });

  it('listSessions sorts newest first', async () => {
    await writeMeta(root, {
      id: 'a',
      cwd: '/x',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    });
    await writeMeta(root, {
      id: 'b',
      cwd: '/x',
      createdAt: '2025-02-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    });
    const list = await listSessions(root);
    expect(list.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('listSessions includes desktop-only JSONL sessions', async () => {
    await writeFile(
      sessionFiles(root, 'desktop-list').legacyJsonlPath,
      `${JSON.stringify({
        type: 'session_meta',
        id: 'desktop-list',
        cwd: '/desktop',
        created_at: 1_767_225_600,
      })}\n`,
      'utf8',
    );
    await expect(listSessions(root)).resolves.toEqual([
      expect.objectContaining({ id: 'desktop-list', cwd: '/desktop' }),
    ]);
  });

  it('sessionFiles returns sensible paths', () => {
    const f = sessionFiles('/root', 'abc');
    expect(f.metaPath).toBe('/root/abc.meta.json');
    expect(f.jsonlPath).toBe('/root/abc.v1.jsonl');
    expect(f.legacyJsonlPath).toBe('/root/abc.jsonl');
    expect(f.writerLockPath).toBe('/root/abc.writer.lock');
    expect(f.snapshotsDir).toBe('/root/abc/snapshots');
  });

  it('normalizes a legacy core session without changing legacy bytes', async () => {
    const id = 'legacy-normalize';
    const files = sessionFiles(root, id);
    const legacyMeta = JSON.stringify(
      {
        id,
        cwd: '/legacy',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      null,
      2,
    );
    const legacyJsonl = `${JSON.stringify({
      role: 'user',
      content: [{ type: 'text', text: 'old' }],
    })}\n`;
    await writeFile(files.metaPath, legacyMeta, 'utf8');
    await writeFile(files.legacyJsonlPath, legacyJsonl, 'utf8');

    await appendMessage(root, id, {
      role: 'assistant',
      content: [{ type: 'text', text: 'new' }],
    });

    expect(await readFile(files.metaPath, 'utf8')).toBe(legacyMeta);
    expect(await readFile(files.legacyJsonlPath, 'utf8')).toBe(legacyJsonl);
    const parsed = await readSessionRecords(root, id);
    expect(parsed.format).toBe('canonical-v1');
    expect(parsed.meta).toMatchObject({ id, cwd: '/legacy' });
    expect(parsed.messages).toHaveLength(2);
  });

  it('rejects a second writer instead of interleaving records', async () => {
    const id = 'writer-owned';
    const files = sessionFiles(root, id);
    await writeFile(files.writerLockPath, '{"pid":1}', 'utf8');

    await expect(
      appendMessage(root, id, { role: 'user', content: [{ type: 'text', text: 'x' }] }),
    ).rejects.toBeInstanceOf(SessionWriterConflictError);
    await expect(readFile(files.jsonlPath, 'utf8')).rejects.toThrow();
  });
});
