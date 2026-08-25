// Tests for /shells, which drives the session-scoped ShellRegistry the REPL
// owns (ctx.shells). Uses a real registry — a persistent shell is a real
// process and the interesting assertions are about real ones being listed and
// really closed.

import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { SessionManager, ShellRegistry } from '@deepcode/core';
import { CommandRegistry, type SessionContext } from './commands.js';

const reg = new CommandRegistry();
const opened: ShellRegistry[] = [];

function registry(): ShellRegistry {
  const r = new ShellRegistry();
  opened.push(r);
  return r;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((r) => r.closeAll()));
});

function ctx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    cwd: tmpdir(),
    model: 'deepseek-chat',
    mode: 'default',
    effort: 'medium',
    settings: {},
    creds: { apiKey: 'sk-test' },
    sessionId: 's1',
    sessions: new SessionManager({ root: tmpdir() }),
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 },
    ...overrides,
  };
}

const run = async (args: string[], c: SessionContext): Promise<string> =>
  (await reg.match('/shells')!.cmd.run(args, c)).join('\n');

describe('/shells', () => {
  it('says what opens a shell when none are open', async () => {
    const out = await run([], ctx({ shells: registry() }));
    expect(out).toContain('No persistent shells open');
    expect(out).toContain('ShellOpen');
  });

  it('lists an open shell with where it started', async () => {
    const shells = registry();
    const id = await shells.open({ cwd: tmpdir() });
    const out = await run([], ctx({ shells }));
    expect(out).toContain(id);
    expect(out).toContain(tmpdir());
    expect(out).toContain('close when this session ends');
  });

  it('closes a shell for real, not just from the listing', async () => {
    const shells = registry();
    const id = await shells.open({ cwd: tmpdir() });
    expect(await run(['close', id], ctx({ shells }))).toContain(`Closed ${id}`);
    expect(shells.get(id)).toBeUndefined();
    expect(shells.list()).toEqual([]);
  });

  it('reports an unknown id instead of claiming it closed something', async () => {
    const out = await run(['close', 'shell-999'], ctx({ shells: registry() }));
    expect(out).toContain('No open shell');
  });

  it('asks for an id when close is given none', async () => {
    expect(await run(['close'], ctx({ shells: registry() }))).toContain('Usage:');
  });

  it('rejects an unrecognised argument rather than silently listing', async () => {
    const out = await run(['kill', 'shell-1'], ctx({ shells: registry() }));
    expect(out).toContain('Unknown argument');
  });

  it('says so when the host owns no registry', async () => {
    expect(await run([], ctx())).toContain('unavailable');
  });
});
