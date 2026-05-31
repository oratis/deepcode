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

  it('/plugins shows empty + install hint when none wired', async () => {
    const reg = new CommandRegistry();
    const out = await reg.match('/plugins')!.cmd.run([], makeContext());
    expect(out.join('\n')).toMatch(/No plugins installed/);
    expect(out.join('\n')).toMatch(/deepcode plugin install/);
  });

  it('/plugins lists wired plugins + contributed hook events', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext({
      wiredPlugins: [
        { name: 'demo', version: '1.0.0', contributedHookEvents: ['PostToolUse'] },
        { name: 'silent', version: '0.1.0', contributedHookEvents: [] },
      ],
    });
    const out = await reg.match('/plugins')!.cmd.run([], ctx);
    const joined = out.join('\n');
    expect(joined).toMatch(/Active plugins \(2\)/);
    expect(joined).toMatch(/demo@1\.0\.0/);
    expect(joined).toMatch(/PostToolUse/);
    expect(joined).toMatch(/silent@0\.1\.0/);
  });

  it('/plugins surfaces warnings (hash drift / spawn failure)', async () => {
    const reg = new CommandRegistry();
    const ctx = makeContext({
      pluginWarnings: ['drifty: hash drift (was abc, now def)', 'bad: failed to start'],
    });
    const out = await reg.match('/plugins')!.cmd.run([], ctx);
    const joined = out.join('\n');
    expect(joined).toMatch(/Warnings/);
    expect(joined).toMatch(/hash drift/);
    expect(joined).toMatch(/failed to start/);
  });

  it('/todos returns "No active todos" when none stored', async () => {
    const reg = new CommandRegistry();
    const sm = new SessionManager({ root: sessRoot });
    const meta = await sm.create('/foo');
    const ctx = makeContext({ sessions: sm, sessionId: meta.id });
    const out = await reg.match('/todos')!.cmd.run([], ctx);
    expect(out.join('\n')).toMatch(/No active todos/);
  });

  describe('/rewind', () => {
    it('reports empty when no snapshots exist', async () => {
      const reg = new CommandRegistry();
      const sm = new SessionManager({ root: sessRoot });
      const meta = await sm.create('/foo');
      const ctx = makeContext({ sessions: sm, sessionId: meta.id });
      const out = await reg.match('/rewind')!.cmd.run([], ctx);
      expect(out.join('\n')).toMatch(/No snapshots in this session yet/);
    });

    it('lists snapshots and explains action menu', async () => {
      const fs = await import('node:fs/promises');
      const reg = new CommandRegistry();
      const sm = new SessionManager({ root: sessRoot });
      const meta = await sm.create(sessRoot);
      // Create a real file + capture
      const file = join(sessRoot, 'a.txt');
      await fs.writeFile(file, 'v1');
      await sm.snapshot({
        sessionId: meta.id,
        cwd: sessRoot,
        filePath: file,
        reason: 'pre-Edit',
        seq: 1,
      });
      const ctx = makeContext({ sessions: sm, sessionId: meta.id });
      const out = await reg.match('/rewind')!.cmd.run([], ctx);
      const joined = out.join('\n');
      expect(joined).toMatch(/Snapshots \(1\)/);
      expect(joined).toMatch(/pre-Edit/);
      expect(joined).toMatch(/code/);
      expect(joined).toMatch(/conversation/);
      expect(joined).toMatch(/summarize-from/);
      expect(joined).toMatch(/summarize-up-to/);
    });

    it('restores file content with `code` action', async () => {
      const fs = await import('node:fs/promises');
      const reg = new CommandRegistry();
      const sm = new SessionManager({ root: sessRoot });
      const meta = await sm.create(sessRoot);
      const file = join(sessRoot, 'a.txt');
      await fs.writeFile(file, 'original');
      const snap = await sm.snapshot({
        sessionId: meta.id,
        cwd: sessRoot,
        filePath: file,
        reason: 'pre-Edit',
        seq: 1,
      });
      // Modify the file after snapshot
      await fs.writeFile(file, 'changed');
      const ctx = makeContext({ sessions: sm, sessionId: meta.id });
      const out = await reg
        .match(`/rewind ${snap!.seq} code`)!
        .cmd.run([String(snap!.seq), 'code'], ctx);
      expect(out.join('\n')).toMatch(/Restored/);
      const after = await fs.readFile(file, 'utf8');
      expect(after).toBe('original');
    });

    it('trims conversation with `conversation` action by capture timestamp', async () => {
      const fs = await import('node:fs/promises');
      const reg = new CommandRegistry();
      const sm = new SessionManager({ root: sessRoot });
      const meta = await sm.create(sessRoot);
      const file = join(sessRoot, 'a.txt');
      await fs.writeFile(file, 'v1');
      // history: 1 message BEFORE snapshot, 1 AFTER
      const before = {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'first' }],
        timestamp: new Date(Date.now() - 60_000).toISOString(),
      };
      // capture
      const snap = await sm.snapshot({
        sessionId: meta.id,
        cwd: sessRoot,
        filePath: file,
        reason: 'pre-Edit',
        seq: 1,
      });
      const after = {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'second' }],
        timestamp: new Date(Date.now() + 60_000).toISOString(),
      };
      const ctx = makeContext({
        sessions: sm,
        sessionId: meta.id,
        history: [before, after],
      });
      const out = await reg
        .match(`/rewind ${snap!.seq} conversation`)!
        .cmd.run([String(snap!.seq), 'conversation'], ctx);
      expect(out.join('\n')).toMatch(/kept 1 of 2 messages/);
      expect(ctx.newHistory).toEqual([before]);
    });

    it('rejects bad seq numbers', async () => {
      const fs = await import('node:fs/promises');
      const reg = new CommandRegistry();
      const sm = new SessionManager({ root: sessRoot });
      const meta = await sm.create(sessRoot);
      const file = join(sessRoot, 'a.txt');
      await fs.writeFile(file, 'v1');
      // Capture at least one snapshot so we move past the early-exit.
      await sm.snapshot({
        sessionId: meta.id,
        cwd: sessRoot,
        filePath: file,
        reason: 'pre-Edit',
        seq: 1,
      });
      const ctx = makeContext({ sessions: sm, sessionId: meta.id });
      const out = await reg.match('/rewind 999 code')!.cmd.run(['999', 'code'], ctx);
      expect(out.join('\n')).toMatch(/No snapshot with seq #999/);
    });
  });
});

describe('inspector + export commands', () => {
  const reg = new CommandRegistry();
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-cmds-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('/hooks lists configured events or reports none', async () => {
    const none = await reg.match('/hooks')!.cmd.run([], makeContext());
    expect(none.join('\n')).toMatch(/No hooks configured/);

    const ctx = makeContext({
      settings: {
        hooks: { Stop: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
      },
    });
    const out = await reg.match('/hooks')!.cmd.run([], ctx);
    expect(out.join('\n')).toMatch(/Stop:/);
    expect(out.join('\n')).toMatch(/command \(match: Bash\)/);
  });

  it('/permissions shows rules + default mode', async () => {
    const none = await reg.match('/permissions')!.cmd.run([], makeContext());
    expect(none.join('\n')).toMatch(/No permission rules/);

    const ctx = makeContext({
      settings: {
        permissions: { defaultMode: 'plan', allow: ['Bash(npm test:*)'], deny: ['Bash(rm:*)'] },
      },
    });
    const out = (await reg.match('/permissions')!.cmd.run([], ctx)).join('\n');
    expect(out).toMatch(/default mode: plan/);
    expect(out).toMatch(/Bash\(npm test:\*\)/);
    expect(out).toMatch(/Bash\(rm:\*\)/);
  });

  it('/agents lists a project sub-agent', async () => {
    const dir = join(cwd, '.deepcode', 'agents');
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, 'explorer.md'),
      '---\nname: explorer\ndescription: read-only explorer\n---\nExplore.\n',
    );
    const out = (await reg.match('/agents')!.cmd.run([], makeContext({ cwd }))).join('\n');
    expect(out).toMatch(/explorer/);
    expect(out).toMatch(/read-only explorer/);
  });

  it('/skills lists a project skill', async () => {
    const dir = join(cwd, '.deepcode', 'skills', 'greet');
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: greet\ndescription: say hi\n---\nGreet.\n',
    );
    const out = (await reg.match('/skills')!.cmd.run([], makeContext({ cwd }))).join('\n');
    expect(out).toMatch(/greet/);
    expect(out).toMatch(/\[project\]/);
  });

  it('/export writes a markdown file and reports the path', async () => {
    const fs = await import('node:fs/promises');
    const ctx = makeContext({
      cwd,
      history: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
      ],
    });
    const out = (await reg.match('/export')!.cmd.run([], ctx)).join('\n');
    expect(out).toMatch(/Exported 2 messages/);
    const written = await fs.readFile(join(cwd, 'deepcode-sess-xyz.md'), 'utf8');
    expect(written).toContain('## User');
    expect(written).toContain('hi there');
  });

  it('/export reports nothing to export with empty history', async () => {
    const out = await reg.match('/export')!.cmd.run([], makeContext({ history: [] }));
    expect(out.join('\n')).toMatch(/Nothing to export/);
  });

  it('/compact needs a provider', async () => {
    const ctx = makeContext({
      history: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    });
    const out = await reg.match('/compact')!.cmd.run([], ctx);
    expect(out.join('\n')).toMatch(/needs a provider/);
  });

  it('/compact reports nothing with empty history', async () => {
    const out = await reg
      .match('/compact')!
      .cmd.run([], makeContext({ provider: { name: 'm', runTurn: async () => ({}) } as never }));
    expect(out.join('\n')).toMatch(/Nothing to compact/);
  });
});
