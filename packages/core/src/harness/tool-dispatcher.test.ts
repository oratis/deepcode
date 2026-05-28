import { describe, expect, it } from 'vitest';
import { HookDispatcher } from '../hooks/index.js';
import { dispatchToolCall } from './tool-dispatcher.js';

describe('dispatchToolCall', () => {
  it('mode=default + permission=allow → allow (source: permission)', async () => {
    const v = await dispatchToolCall({
      tool: 'Read',
      input: { file_path: '/x' },
      mode: 'default',
      rules: { allow: ['Read'] },
      cwd: '/tmp',
    });
    expect(v.decision).toBe('allow');
  });

  it('mode=plan blocks write tools (short-circuit, hook does not fire)', async () => {
    // hookFired flag retained for documentation but not asserted directly
    const hooks = new HookDispatcher({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo hook' }] }],
      },
    });
    // We can't easily detect "did not fire" without inspecting timings; do it indirectly
    const v = await dispatchToolCall({
      tool: 'Write',
      input: { file_path: '/x' },
      mode: 'plan',
      rules: { allow: ['Write'] }, // allowed by permission, but plan-blocked
      hooks,
      cwd: '/tmp',
    });
    expect(v.decision).toBe('plan-blocked');
    expect(v.source).toBe('mode');
    expect(v.hook).toBeUndefined(); // hook did not run
  });

  it('mode=acceptEdits + permission=deny → deny (permission wins)', async () => {
    const v = await dispatchToolCall({
      tool: 'Edit',
      input: { file_path: '/x' },
      mode: 'acceptEdits',
      rules: { deny: ['Edit'] },
      cwd: '/tmp',
    });
    expect(v.decision).toBe('deny');
  });

  it('mode=bypassPermissions → allow even when deny rule', async () => {
    const v = await dispatchToolCall({
      tool: 'Bash',
      input: { command: 'rm -rf /' },
      mode: 'bypassPermissions',
      rules: { deny: ['Bash'] },
      cwd: '/tmp',
    });
    expect(v.decision).toBe('allow');
  });

  it('mode=dontAsk + no-match → deny', async () => {
    const v = await dispatchToolCall({
      tool: 'Bash',
      input: { command: 'ls' },
      mode: 'dontAsk',
      rules: {},
      cwd: '/tmp',
    });
    expect(v.decision).toBe('deny');
  });

  it('hook JSON output decision=deny overrides mode=allow', async () => {
    const hooks = new HookDispatcher({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'command',
                command: 'echo \'{"decision":"deny","systemMessage":"hook says no"}\'',
              },
            ],
          },
        ],
      },
    });
    const v = await dispatchToolCall({
      tool: 'Bash',
      input: { command: 'ls' },
      mode: 'default',
      rules: { allow: ['Bash'] },
      hooks,
      cwd: '/tmp',
    });
    expect(v.decision).toBe('deny');
    expect(v.source).toBe('hook');
    expect(v.reason).toMatch(/hook says no/);
  });

  it('hook non-zero exit blocks the call', async () => {
    const hooks = new HookDispatcher({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'exit 1' }] }],
      },
    });
    const v = await dispatchToolCall({
      tool: 'Bash',
      input: { command: 'ls' },
      mode: 'default',
      rules: { allow: ['Bash'] },
      hooks,
      cwd: '/tmp',
    });
    expect(v.decision).toBe('deny');
    expect(v.source).toBe('hook');
  });

  it('without hooks: just mode + permission', async () => {
    const v = await dispatchToolCall({
      tool: 'Read',
      input: { file_path: '/x' },
      mode: 'default',
      rules: { ask: ['Read'] },
      cwd: '/tmp',
    });
    expect(v.decision).toBe('ask');
  });

  it('hook can upgrade allow → ask via JSON output', async () => {
    const hooks = new HookDispatcher({
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: 'command', command: 'echo \'{"decision":"ask"}\'' }],
          },
        ],
      },
    });
    const v = await dispatchToolCall({
      tool: 'Bash',
      input: { command: 'rm test.txt' },
      mode: 'default',
      rules: { allow: ['Bash'] },
      hooks,
      cwd: '/tmp',
    });
    expect(v.decision).toBe('ask');
    expect(v.source).toBe('hook');
  });
});
