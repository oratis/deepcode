import { describe, expect, it } from 'vitest';
import { parseFileContract } from '../config/file-contract.js';
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

describe('dispatchToolCall — file contract', () => {
  const cwd = '/work/repo';
  const secrets = parseFileContract(`version: 1
rules:
  - glob: "**/.env*"
    read: deny
    reason: "Secrets are human-only."
  - glob: "AGENTS.md"
    write: ask
    reason: "Review first."
`);

  it('is a no-op when no contract is supplied', async () => {
    // The property the whole feature rests on: without a contract file, the
    // outcome is bit-for-bit what it was before the contract existed.
    const without = await dispatchToolCall({
      tool: 'Read',
      input: { file_path: '/work/repo/.env' },
      mode: 'default',
      rules: { allow: ['Read'] },
      cwd,
    });
    expect(without.decision).toBe('allow');
  });

  it('denies a read the contract forbids, and explains why', async () => {
    const v = await dispatchToolCall({
      tool: 'Read',
      input: { file_path: '/work/repo/.env' },
      mode: 'default',
      rules: { allow: ['Read'] },
      contract: secrets,
      cwd,
    });
    expect(v.decision).toBe('deny');
    expect(v.source).toBe('contract');
    expect(v.reason).toContain('Secrets are human-only.');
  });

  it('a contract deny survives bypassPermissions', async () => {
    // A standing "never read .env" is not a prompt, so the mode that exists to
    // skip prompts must not clear it — otherwise the contract's strongest
    // sentence is also its easiest to disable.
    const v = await dispatchToolCall({
      tool: 'Read',
      input: { file_path: '/work/repo/.env' },
      mode: 'bypassPermissions',
      contract: secrets,
      cwd,
    });
    expect(v.decision).toBe('deny');
    expect(v.source).toBe('contract');
  });

  it('a contract deny survives an explicit settings allow', async () => {
    const v = await dispatchToolCall({
      tool: 'Read',
      input: { file_path: '/work/repo/.env' },
      mode: 'dontAsk',
      rules: { allow: ['Read'] },
      contract: secrets,
      cwd,
    });
    expect(v.decision).toBe('deny');
  });

  it('tightens allow to ask, attributing it to the contract', async () => {
    const v = await dispatchToolCall({
      tool: 'Write',
      input: { file_path: '/work/repo/AGENTS.md' },
      mode: 'default',
      rules: { allow: ['Write'] },
      contract: secrets,
      cwd,
    });
    expect(v.decision).toBe('ask');
    expect(v.source).toBe('contract');
    expect(v.reason).toContain('Review first.');
  });

  it('never loosens: a settings deny stays denied under a permissive contract', async () => {
    const permissive = parseFileContract('version: 1\nrules:\n  - glob: "**"\n    write: allow\n');
    const v = await dispatchToolCall({
      tool: 'Write',
      input: { file_path: '/work/repo/src/a.ts' },
      mode: 'default',
      rules: { deny: ['Write'] },
      contract: permissive,
      cwd,
    });
    expect(v.decision).toBe('deny');
  });

  it('leaves paths outside the workspace to the sandbox', async () => {
    const v = await dispatchToolCall({
      tool: 'Read',
      input: { file_path: '/etc/.env' },
      mode: 'default',
      rules: { allow: ['Read'] },
      contract: secrets,
      cwd,
    });
    expect(v.decision).toBe('allow');
  });

  it('does not gate Bash on the contract', async () => {
    const v = await dispatchToolCall({
      tool: 'Bash',
      input: { command: 'cat .env' },
      mode: 'default',
      rules: { allow: ['Bash'] },
      contract: secrets,
      cwd,
    });
    expect(v.decision).toBe('allow');
  });

  it('a contract ask is still overridable by a PreToolUse hook', async () => {
    // Contract `ask` is an ordinary approval, unlike `deny`. The hook chain
    // stays the last word for it.
    const hooks = new HookDispatcher({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'command',
                command: `echo '{"permissionDecision":"deny","systemMessage":"hook says no"}'`,
              },
            ],
          },
        ],
      },
    });
    const v = await dispatchToolCall({
      tool: 'Write',
      input: { file_path: '/work/repo/AGENTS.md' },
      mode: 'default',
      rules: { allow: ['Write'] },
      contract: secrets,
      hooks,
      cwd,
    });
    expect(v.decision).toBe('deny');
    expect(v.source).toBe('hook');
  });
});
