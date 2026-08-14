import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from './manager.js';
import { excerptAround, inWorkspace, searchSessions } from './search.js';
import type { StoredMessage } from '../types.js';

function userMessage(text: string): StoredMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp: new Date().toISOString() };
}

describe('inWorkspace', () => {
  it('accepts the workspace itself and anything below it', () => {
    expect(inWorkspace('/a/project', '/a/project')).toBe(true);
    expect(inWorkspace('/a/project/sub', '/a/project')).toBe(true);
  });

  it('does not treat a sibling with a shared prefix as inside', () => {
    // /a/project must not capture /a/project-two.
    expect(inWorkspace('/a/project-two', '/a/project')).toBe(false);
  });

  it('rejects a parent, and anything unrelated', () => {
    expect(inWorkspace('/a', '/a/project')).toBe(false);
    expect(inWorkspace('/b/other', '/a/project')).toBe(false);
  });

  it('refuses to guess about relative paths', () => {
    expect(inWorkspace('project', '/a/project')).toBe(false);
  });
});

describe('excerptAround', () => {
  it('marks both ends when it cut text off', () => {
    const text = 'x'.repeat(500) + 'NEEDLE' + 'y'.repeat(500);
    const out = excerptAround(text, 500, 6, 20);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toContain('NEEDLE');
  });

  it('marks neither end when nothing was cut', () => {
    const out = excerptAround('short NEEDLE here', 6, 6, 100);
    expect(out).toBe('short NEEDLE here');
  });

  it('collapses whitespace so a match stays readable on one line', () => {
    expect(excerptAround('a\n\n  b NEEDLE c', 8, 6, 100)).toBe('a b NEEDLE c');
  });
});

describe('searchSessions', () => {
  let root: string;
  let manager: SessionManager;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dc-search-'));
    manager = new SessionManager({ root });
  });

  async function seed(cwd: string, texts: string[]): Promise<string> {
    const session = await manager.create(cwd);
    for (const text of texts) await manager.append(session.id, userMessage(text));
    return session.id;
  }

  it('finds a match and says where it came from', async () => {
    const id = await seed('/work/app', ['the CI failure was a missing pnpm lockfile']);
    const result = await searchSessions({ root, query: 'lockfile', cwd: '/work/app' });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].sessionId).toBe(id);
    expect(result.hits[0].messageIndex).toBe(0);
    expect(result.hits[0].excerpt).toContain('lockfile');
  });

  it('matches without regard to case', async () => {
    await seed('/work/app', ['A Missing Lockfile']);
    expect((await searchSessions({ root, query: 'lockfile', cwd: '/work/app' })).hits).toHaveLength(
      1,
    );
  });

  it('does not reach into another workspace by default', async () => {
    // The privacy rule: another project's session must not surface here.
    await seed('/work/other', ['the secret is hunter2']);
    const result = await searchSessions({ root, query: 'hunter2', cwd: '/work/app' });
    expect(result.hits).toHaveLength(0);
    expect(result.sessionsSearched).toBe(0);
  });

  it('reaches everything only when told to', async () => {
    await seed('/work/other', ['the secret is hunter2']);
    const result = await searchSessions({
      root,
      query: 'hunter2',
      cwd: '/work/app',
      scope: 'all',
    });
    expect(result.hits).toHaveLength(1);
  });

  it('includes sessions from below the workspace root', async () => {
    await seed('/work/app/packages/core', ['nested finding']);
    expect((await searchSessions({ root, query: 'nested', cwd: '/work/app' })).hits).toHaveLength(
      1,
    );
  });

  it('excludes the running session, which the agent can already see', async () => {
    const id = await seed('/work/app', ['current conversation']);
    const result = await searchSessions({
      root,
      query: 'current',
      cwd: '/work/app',
      excludeSessionId: id,
    });
    expect(result.hits).toHaveLength(0);
  });

  it('stops at the limit and says it did', async () => {
    await seed('/work/app', ['match one', 'match two', 'match three']);
    const result = await searchSessions({ root, query: 'match', cwd: '/work/app', limit: 2 });
    expect(result.hits).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('returns nothing for an empty query rather than everything', async () => {
    await seed('/work/app', ['anything at all']);
    const result = await searchSessions({ root, query: '', cwd: '/work/app' });
    expect(result.hits).toHaveLength(0);
  });

  it('searches the most recently updated sessions first', async () => {
    await seed('/work/app', ['older mention of widgets']);
    await new Promise((r) => setTimeout(r, 10));
    const newer = await seed('/work/app', ['newer mention of widgets']);
    const result = await searchSessions({ root, query: 'widgets', cwd: '/work/app', limit: 1 });
    expect(result.hits[0].sessionId).toBe(newer);
  });

  it('returns nothing when the directory does not exist', async () => {
    const result = await searchSessions({
      root: join(root, 'nope'),
      query: 'x',
      cwd: '/work/app',
    });
    expect(result).toEqual({ hits: [], sessionsSearched: 0, truncated: false });
  });
});
