import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '@deepcode/core';
import { CommandRegistry, type SessionContext } from './commands.js';

function makeContext(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    cwd: '/tmp/x',
    model: 'deepseek-chat',
    mode: 'default',
    effort: 'medium',
    settings: {},
    creds: { apiKey: 'sk-abcdefghij' },
    sessionId: 'sess-xyz',
    sessions: new SessionManager({ root: '/tmp/x' }),
    usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 0 },
    ...overrides,
  };
}

describe('CommandRegistry', () => {
  const reg = new CommandRegistry();

  it('matches /help', () => {
    expect(reg.match('/help')).toMatchObject({ cmd: { name: '/help' } });
  });

  it('matches alias /?', () => {
    expect(reg.match('/?')).toMatchObject({ cmd: { name: '/help' } });
  });

  it('matches with args', () => {
    const m = reg.match('/model deepseek-reasoner');
    expect(m?.cmd.name).toBe('/model');
    expect(m?.args).toEqual(['deepseek-reasoner']);
  });

  it('returns null for non-slash input', () => {
    expect(reg.match('not a command')).toBeNull();
    expect(reg.match('hello /world')).toBeNull();
  });

  it('returns null for unknown command', () => {
    expect(reg.match('/nope')).toBeNull();
  });

  it('list() includes all built-ins (deduped by alias)', () => {
    const names = reg.list().map((c) => c.name);
    expect(names).toContain('/help');
    expect(names).toContain('/model');
    expect(names).toContain('/mode');
    expect(names).toContain('/exit');
    expect(new Set(names).size).toBe(names.length); // no dupes
  });
});

describe('built-in command behavior', () => {
  let sessRoot: string;
  beforeEach(async () => {
    sessRoot = await mkdtemp(join(tmpdir(), 'dc-cmd-'));
  });
  afterEach(async () => {
    await rm(sessRoot, { recursive: true, force: true });
  });

  it('/help lists commands', async () => {
    const reg = new CommandRegistry();
    const m = reg.match('/help')!;
    const out = await m.cmd.run([], makeContext());
    expect(out.join('\n')).toMatch(/\/help/);
    expect(out.join('\n')).toMatch(/\/exit/);
  });

  it('/clear sets clearHistory flag', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext();
    const m = reg.match('/clear')!;
    await m.cmd.run([], ctx);
    expect(ctx.clearHistory).toBe(true);
  });

  it('/exit sets exitRequested', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext();
    await reg.match('/exit')!.cmd.run([], ctx);
    expect(ctx.exitRequested).toBe(true);
  });

  it('/model switches model when valid', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext();
    await reg.match('/model deepseek-reasoner')!.cmd.run(['deepseek-reasoner'], ctx);
    expect(ctx.model).toBe('deepseek-reasoner');
  });

  it('/model rejects invalid name', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext();
    const out = await reg.match('/model wrong')!.cmd.run(['wrong'], ctx);
    expect(out.join('\n')).toMatch(/Unknown model/);
    expect(ctx.model).toBe('deepseek-chat'); // unchanged
  });

  it('/mode switches when valid', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext();
    await reg.match('/mode plan')!.cmd.run(['plan'], ctx);
    expect(ctx.mode).toBe('plan');
  });

  it('/effort switches when valid', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext();
    await reg.match('/effort high')!.cmd.run(['high'], ctx);
    expect(ctx.effort).toBe('high');
  });

  it('/status emits session info', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext({ sessions: new SessionManager({ root: sessRoot }) });
    const out = await reg.match('/status')!.cmd.run([], ctx);
    const joined = out.join('\n');
    expect(joined).toMatch(/Session/);
    expect(joined).toMatch(/Model/);
    expect(joined).toMatch(/sk-a…ghij/); // redacted key
  });

  it('/cost computes pricing', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext({
      usage: { inputTokens: 1_000_000, outputTokens: 500_000, reasoningTokens: 0 },
    });
    const out = await reg.match('/cost')!.cmd.run([], ctx);
    expect(out.join('\n')).toMatch(/Tokens/);
    expect(out.join('\n')).toMatch(/Total/);
  });

  it('/context shows window usage', async () => {
    const reg = new CommandRegistry();
    const out = await reg.match('/context')!.cmd.run([], makeContext());
    expect(out.join('\n')).toMatch(/128,000/);
    expect(out.join('\n')).toMatch(/Context:/);
  });

  it('/config dumps settings', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext({ settings: { model: 'deepseek-chat' } });
    const out = await reg.match('/config')!.cmd.run([], ctx);
    expect(out.join('\n')).toMatch(/Current settings/);
    expect(out.join('\n')).toMatch(/deepseek-chat/);
  });

  it('/resume reports no sessions cleanly', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext({ sessions: new SessionManager({ root: sessRoot }) });
    const out = await reg.match('/resume')!.cmd.run([], ctx);
    expect(out.join('\n')).toMatch(/No previous sessions/);
  });

  it('/resume lists known sessions', async () => {
    const reg = new CommandRegistry();
    const sm = new SessionManager({ root: sessRoot });
    await sm.create('/foo');
    await sm.create('/bar');
    const ctx = makeContext({ sessions: sm });
    const out = await reg.match('/resume')!.cmd.run([], ctx);
    expect(out.join('\n')).toMatch(/Recent sessions/);
  });
});
