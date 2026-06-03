// Tests for resolveSession — the resume / continue / fork decision behind the
// --resume / --continue / --fork-session CLI flags. Pure over a SessionManager
// pointed at a throwaway root, so no live REPL or provider is needed.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, type StoredMessage } from '@deepcode/core';
import { resolveSession } from './repl.js';

const roots: string[] = [];
async function freshManager(): Promise<SessionManager> {
  const root = await mkdtemp(join(tmpdir(), 'dc-resume-'));
  roots.push(root);
  return new SessionManager({ root });
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function text(t: string): StoredMessage {
  return { role: 'user', content: [{ type: 'text', text: t }] };
}

describe('resolveSession', () => {
  it('starts a fresh session by default', async () => {
    const sm = await freshManager();
    const r = await resolveSession(sm, '/proj', 'deepseek-chat', {});
    expect(r.seededHistory).toEqual([]);
    expect(r.notice).toBeUndefined();
    expect(r.session.cwd).toBe('/proj');
  });

  it('--resume <id> resumes that session with its stored history', async () => {
    const sm = await freshManager();
    const s = await sm.create('/proj', { model: 'deepseek-chat' });
    await sm.append(s.id, text('hello'));
    await sm.append(s.id, text('world'));
    const r = await resolveSession(sm, '/proj', 'deepseek-chat', { resumeId: s.id });
    expect(r.session.id).toBe(s.id);
    expect(r.seededHistory).toHaveLength(2);
    expect(r.notice).toContain('Resumed');
  });

  it('--continue picks the most recent session in the same cwd', async () => {
    const sm = await freshManager();
    const older = await sm.create('/proj', {});
    await sm.append(older.id, text('older'));
    await sleep(10); // guarantee a strictly-later updatedAt
    const newer = await sm.create('/proj', {});
    await sm.append(newer.id, text('newer'));
    // a more-recently-touched session in a DIFFERENT cwd must be ignored
    await sleep(10);
    const other = await sm.create('/elsewhere', {});
    await sm.append(other.id, text('elsewhere'));

    const r = await resolveSession(sm, '/proj', 'deepseek-chat', { continueSession: true });
    expect(r.session.id).toBe(newer.id);
    expect(r.seededHistory).toHaveLength(1);
    expect(r.seededHistory[0]!.content[0]).toMatchObject({ text: 'newer' });
  });

  it('--continue with no session in this cwd starts fresh', async () => {
    const sm = await freshManager();
    await sm.create('/elsewhere', {});
    const r = await resolveSession(sm, '/proj', 'deepseek-chat', { continueSession: true });
    expect(r.seededHistory).toEqual([]);
    expect(r.notice).toMatch(/no previous session/i);
  });

  it('--fork-session copies history into a new id and leaves the source intact', async () => {
    const sm = await freshManager();
    const src = await sm.create('/proj', { model: 'deepseek-chat' });
    await sm.append(src.id, text('a'));
    await sm.append(src.id, text('b'));

    const r = await resolveSession(sm, '/proj', 'deepseek-chat', {
      resumeId: src.id,
      forkSession: true,
    });
    expect(r.session.id).not.toBe(src.id);
    expect(r.seededHistory).toHaveLength(2);
    expect(r.notice).toContain('Forked');

    // The forked session persisted a copy …
    const forked = await sm.load(r.session.id);
    expect(forked!.messages).toHaveLength(2);
    // … and the source is untouched.
    const source = await sm.load(src.id);
    expect(source!.messages).toHaveLength(2);
  });

  it('falls back to a fresh session when the resume id is unknown', async () => {
    const sm = await freshManager();
    const r = await resolveSession(sm, '/proj', 'deepseek-chat', {
      resumeId: 'nope-does-not-exist',
    });
    expect(r.seededHistory).toEqual([]);
    expect(r.notice).toMatch(/not found/i);
  });
});
