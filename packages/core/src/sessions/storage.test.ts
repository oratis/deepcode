import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendMessage,
  listSessions,
  newSessionId,
  readMessages,
  readMeta,
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
  });

  it('readMessages returns [] when jsonl missing', async () => {
    expect(await readMessages(root, 'nope')).toEqual([]);
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

  it('sessionFiles returns sensible paths', () => {
    const f = sessionFiles('/root', 'abc');
    expect(f.metaPath).toBe('/root/abc.meta.json');
    expect(f.jsonlPath).toBe('/root/abc.jsonl');
    expect(f.snapshotsDir).toBe('/root/abc/snapshots');
  });
});
