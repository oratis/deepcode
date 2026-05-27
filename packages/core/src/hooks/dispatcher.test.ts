import { mkdtemp, rm } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HookDispatcher, runCommand, tryParseJsonOutput } from './dispatcher.js';

describe('HookDispatcher', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-hooks-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('returns empty result for unconfigured event', async () => {
    const d = new HookDispatcher({});
    const r = await d.dispatch({
      event: 'PreToolUse',
      cwd,
      triggeredAt: '2026-01-01',
      payload: { tool: 'Read' },
    });
    expect(r.stdout).toBe('');
    expect(r.anyBlocked).toBe(false);
    expect(r.timings).toEqual([]);
  });

  it('runs command-type handler and captures stdout', async () => {
    const d = new HookDispatcher({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hello-hook' }] }],
      },
    });
    const r = await d.dispatch({
      event: 'PreToolUse',
      cwd,
      triggeredAt: '2026-01-01',
      payload: { tool: 'Bash' },
    });
    expect(r.stdout).toContain('hello-hook');
    expect(r.timings).toHaveLength(1);
    expect(r.timings[0]?.exitCode).toBe(0);
  });

  it('skips handlers whose matcher does not apply', async () => {
    const d = new HookDispatcher({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo SHOULD_NOT_RUN' }] },
          { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo edit-hook' }] },
        ],
      },
    });
    const r = await d.dispatch({
      event: 'PreToolUse',
      cwd,
      triggeredAt: '2026-01-01',
      payload: { tool: 'Edit' },
    });
    expect(r.stdout).not.toContain('SHOULD_NOT_RUN');
    expect(r.stdout).toContain('edit-hook');
  });

  it('matcher supports | OR separator', async () => {
    const d = new HookDispatcher({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit|Write',
            hooks: [{ type: 'command', command: 'echo edit-or-write' }],
          },
        ],
      },
    });
    const writeResult = await d.dispatch({
      event: 'PreToolUse',
      cwd,
      triggeredAt: '2026-01-01',
      payload: { tool: 'Write' },
    });
    expect(writeResult.stdout).toContain('edit-or-write');
    const editResult = await d.dispatch({
      event: 'PreToolUse',
      cwd,
      triggeredAt: '2026-01-01',
      payload: { tool: 'Edit' },
    });
    expect(editResult.stdout).toContain('edit-or-write');
  });

  it('non-zero exit sets anyBlocked', async () => {
    const d = new HookDispatcher({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo blocked >&2; exit 2' }] }],
      },
    });
    const r = await d.dispatch({
      event: 'PreToolUse',
      cwd,
      triggeredAt: '2026-01-01',
      payload: { tool: 'Bash' },
    });
    expect(r.anyBlocked).toBe(true);
    expect(r.timings[0]?.exitCode).toBe(2);
    expect(r.stderr).toContain('blocked');
  });

  it('parses JSON output schema from stdout', async () => {
    const d = new HookDispatcher({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'command',
                command:
                  'echo \'{"decision":"deny","systemMessage":"nope","additionalContext":"context"}\'',
              },
            ],
          },
        ],
      },
    });
    const r = await d.dispatch({
      event: 'PreToolUse',
      cwd,
      triggeredAt: '2026-01-01',
      payload: { tool: 'Bash' },
    });
    expect(r.json?.decision).toBe('deny');
    expect(r.json?.systemMessage).toBe('nope');
    expect(r.json?.additionalContext).toBe('context');
  });

  it('disableAllHooks suppresses all execution', async () => {
    const d = new HookDispatcher({
      disableAllHooks: true,
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo SHOULD_NOT_RUN' }] }],
      },
    });
    const r = await d.dispatch({
      event: 'PreToolUse',
      cwd,
      triggeredAt: '2026-01-01',
      payload: { tool: 'Bash' },
    });
    expect(r.stdout).toBe('');
    expect(r.timings).toEqual([]);
  });

  it('runs multiple events independently', async () => {
    const d = new HookDispatcher({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo session-start' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
      },
    });
    const r1 = await d.dispatch({
      event: 'SessionStart',
      cwd,
      triggeredAt: 't',
      payload: {},
    });
    expect(r1.stdout).toContain('session-start');
    const r2 = await d.dispatch({
      event: 'Stop',
      cwd,
      triggeredAt: 't',
      payload: {},
    });
    expect(r2.stdout).toContain('stop');
  });

  it('reads stdin payload (event + payload as JSON)', async () => {
    const stdinReader = join(cwd, 'reader.sh');
    await fs.writeFile(stdinReader, '#!/bin/sh\ncat\n', 'utf8');
    await fs.chmod(stdinReader, 0o755);
    const d = new HookDispatcher({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: stdinReader }] }],
      },
    });
    const r = await d.dispatch({
      event: 'UserPromptSubmit',
      cwd,
      triggeredAt: 't',
      payload: { prompt: 'hello there' },
    });
    expect(r.stdout).toContain('UserPromptSubmit');
    expect(r.stdout).toContain('hello there');
  });

  it('unimplemented handler types return error in stderr but do not block', async () => {
    const d = new HookDispatcher({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'http', url: 'https://example.com' }] }],
      },
    });
    const r = await d.dispatch({
      event: 'PreToolUse',
      cwd,
      triggeredAt: 't',
      payload: { tool: 'Bash' },
    });
    expect(r.stderr).toMatch(/not implemented/);
    expect(r.anyBlocked).toBe(false);
  });
});

describe('runCommand', () => {
  it('captures stdout and exitCode', async () => {
    const r = await runCommand({
      command: 'echo hi; exit 0',
      cwd: '/tmp',
      timeoutMs: 5000,
      env: process.env as Record<string, string>,
    });
    expect(r.stdout).toContain('hi');
    expect(r.exitCode).toBe(0);
  });

  it('kills on timeout', async () => {
    const r = await runCommand({
      command: 'sleep 5',
      cwd: '/tmp',
      timeoutMs: 100,
      env: process.env as Record<string, string>,
    });
    expect(r.exitCode).toBe(124);
    expect(r.stderr).toMatch(/killed by timeout/);
  });
});

describe('tryParseJsonOutput', () => {
  it('parses pure JSON', () => {
    expect(tryParseJsonOutput('{"decision":"allow"}')?.decision).toBe('allow');
  });
  it('parses JSON after log lines', () => {
    const r = tryParseJsonOutput('log line 1\nlog line 2\n{"decision":"deny"}');
    expect(r?.decision).toBe('deny');
  });
  it('returns null on no JSON', () => {
    expect(tryParseJsonOutput('plain text')).toBeNull();
  });
  it('returns null on empty', () => {
    expect(tryParseJsonOutput('')).toBeNull();
  });
});
