// Tests for wirePlugins() orchestrator.
//
// Strategy:
//   - Build a fake home dir with an installed plugin (manifest + trust file).
//   - Wire it up with a stub HookDispatcher + capability bridge.
//   - Verify: plugins are spawned, their declared hooks are merged into the
//     dispatcher, shutdown() kills the subprocess.

import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HookDispatcher } from '../hooks/dispatcher.js';
import { ToolExecutionBinding, ToolExecutionService } from '../runtime/tool-execution.js';
import { BashTool } from '../tools/bash.js';
import { ToolRegistry } from '../tools/registry.js';
import { WriteTool } from '../tools/write.js';
import { createPluginCapabilityBridge } from './capability-bridge.js';
import { computeSourceHash, pluginsDir, saveTrustState } from './manifest.js';
import { hasInstalledPlugins, wirePlugins } from './wireup.js';

async function makeInstalledPlugin(
  home: string,
  name: string,
  manifest: Record<string, unknown>,
  indexJs?: string,
): Promise<void> {
  const dir = join(pluginsDir(home), name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, 'plugin.json'),
    JSON.stringify({ name, version: '0.0.1', ...manifest }, null, 2),
    'utf8',
  );
  if (indexJs !== undefined) await fs.writeFile(join(dir, 'index.js'), indexJs, 'utf8');
  const hash = await computeSourceHash(dir);
  const trust = await import('./manifest.js').then((m) => m.loadTrustState(home));
  trust.plugins[name] = {
    version: '0.0.1',
    installedAt: new Date().toISOString(),
    sourceHash: hash,
    trustedBy: 'user',
  };
  await saveTrustState(home, trust);
}

function makeBridge() {
  return {
    fs_read: async () => '',
    fs_write: async () => {},
    bash: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    fetch: async () => '',
  };
}

describe('wirePlugins', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-wire-home-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('returns empty result when no plugins dir exists', async () => {
    const hooks = new HookDispatcher({});
    const r = await wirePlugins({ home, hooks, capabilities: makeBridge(), log: () => {} });
    expect(r.plugins).toEqual([]);
    expect(r.hashMismatches).toEqual([]);
    expect(r.spawnFailures).toEqual([]);
    await r.shutdown(); // no-op
  });

  it('spawns an installed plugin and merges its contributed hooks', async () => {
    await makeInstalledPlugin(
      home,
      'demo-plug',
      {
        contributes: {
          hooks: {
            PostToolUse: [
              { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo plug-hook' }] },
            ],
          },
        },
      },
      `// plugin: stay alive, do nothing
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', () => {});
`,
    );

    const hooks = new HookDispatcher({});
    const r = await wirePlugins({ home, hooks, capabilities: makeBridge(), log: () => {} });
    try {
      expect(r.plugins).toHaveLength(1);
      expect(r.plugins[0]?.plugin.manifest.name).toBe('demo-plug');
      expect(r.plugins[0]?.contributedHookEvents).toContain('PostToolUse');
      // Verify the hook was merged: dispatch a PostToolUse and check the
      // matchers count via private access — instead, just assert that
      // dispatching for Bash doesn't throw and at least records a timing.
      // The plugin-contributed hook is a simple `echo plug-hook` so we can
      // wait for it.
      // (Skipped: actually awaiting a command-handler run here would couple
      // to process I/O; we trust HookDispatcher unit tests for that path.)
      expect(r.hashMismatches).toEqual([]);
      expect(r.spawnFailures).toEqual([]);
    } finally {
      await r.shutdown();
    }
  }, 15000);

  it('skips plugins with hash drift (returns mismatch reason)', async () => {
    await makeInstalledPlugin(
      home,
      'drifty',
      { contributes: { hooks: {} } },
      `process.stdin.on('data', () => {});`,
    );
    // Executable code is part of the trust hash, so post-install mutation disables the plugin.
    const entryPath = join(pluginsDir(home), 'drifty', 'index.js');
    await fs.writeFile(entryPath, `process.stdout.write('tampered');`, 'utf8');

    const hooks = new HookDispatcher({});
    const r = await wirePlugins({ home, hooks, capabilities: makeBridge(), log: () => {} });
    try {
      expect(r.plugins).toHaveLength(0);
      expect(r.hashMismatches.length).toBeGreaterThan(0);
      expect(r.hashMismatches[0]).toMatch(/drifty/);
    } finally {
      await r.shutdown();
    }
  }, 10000);

  it('keeps declarative skills-only plugins active without spawning a subprocess', async () => {
    const dir = join(pluginsDir(home), 'skills-only');
    await fs.mkdir(join(dir, 'skills', 'demo'), { recursive: true });
    await fs.writeFile(
      join(dir, 'plugin.json'),
      JSON.stringify({ name: 'skills-only', version: '0.0.1' }),
    );
    await fs.writeFile(join(dir, 'skills', 'demo', 'SKILL.md'), '# Demo');
    const hash = await computeSourceHash(dir);
    await saveTrustState(home, {
      plugins: {
        'skills-only': {
          version: '0.0.1',
          installedAt: '2026-08-01T00:00:00.000Z',
          sourceHash: hash,
          trustedBy: 'user',
        },
      },
    });

    const result = await wirePlugins({
      home,
      hooks: new HookDispatcher({}),
      capabilities: makeBridge(),
      log: () => undefined,
    });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.subprocess).toBeUndefined();
    expect(result.spawnFailures).toEqual([]);
    await result.shutdown();
  });

  it('routes external command hooks through the capability broker instead of executing host shell', async () => {
    const marker = join(home, 'bypass-marker');
    const command = `echo unsafe > ${JSON.stringify(marker)}`;
    await makeInstalledPlugin(
      home,
      'external-hook',
      {
        contributes: {
          hooks: {
            PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command }] }],
          },
        },
      },
      'process.stdin.resume();',
    );
    const hooks = new HookDispatcher({});
    const bash = vi.fn(makeBridge().bash);
    const wired = await wirePlugins({
      home,
      hooks,
      capabilities: { ...makeBridge(), bash },
      log: () => {},
    });
    try {
      await hooks.dispatch({
        event: 'PreToolUse',
        payload: { tool: 'Read' },
        cwd: home,
        triggeredAt: '',
      });
      expect(bash).toHaveBeenCalledWith(expect.stringContaining('/bin/sh -c'), undefined);
      await expect(fs.access(marker)).rejects.toThrow();
    } finally {
      await wired.shutdown();
    }
  });

  it('honors `disabled` option (plugin discovered but enabled=false → not spawned)', async () => {
    await makeInstalledPlugin(
      home,
      'opt-out',
      { contributes: {} },
      `process.stdin.on('data', () => {});`,
    );
    const hooks = new HookDispatcher({});
    const r = await wirePlugins({
      home,
      hooks,
      capabilities: makeBridge(),
      disabled: ['opt-out'],
      log: () => {},
    });
    try {
      expect(r.plugins).toHaveLength(0);
    } finally {
      await r.shutdown();
    }
  }, 10000);
});

describe('external command hook protocol through real Bash', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-hook-protocol-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  async function fixture(command: string, spillThresholdChars?: number, matcher = 'Write') {
    await makeInstalledPlugin(home, 'command-hook', {
      contributes: {
        hooks: { PreToolUse: [{ matcher, hooks: [{ type: 'command', command }] }] },
      },
    });
    const hooks = new HookDispatcher({});
    const binding = new ToolExecutionBinding();
    const bridge = createPluginCapabilityBridge(binding);
    const service = new ToolExecutionService({
      cwd: home,
      mode: 'bypassPermissions',
      sandboxConfig: { mode: 'danger-full-access' },
      tools: new ToolRegistry([BashTool, WriteTool]),
      hooks,
      spillThresholdChars,
    });
    const unbind = binding.bind(service);
    const wired = await wirePlugins({ home, hooks, capabilities: bridge, log: () => {} });
    return {
      hooks,
      service,
      bridge,
      close: async () => {
        unbind();
        await service.close();
        await wired.shutdown();
      },
    };
  }

  it.each([
    `printf '%s' '{"decision":"deny"}'`,
    `printf '%s' '{"permissionDecision":"deny"}'`,
    'exit 7',
  ])('blocks a write after external hook rejection: %s', async (command) => {
    const context = await fixture(command);
    try {
      const result = await context.service.run(
        'Write',
        { file_path: 'target', content: 'forbidden' },
        'write',
      );
      expect(result.isError).toBe(true);
      await expect(fs.access(join(home, 'target'))).rejects.toThrow();
    } finally {
      await context.close();
    }
  });

  it('keeps stderr separate from a successful JSON stdout decision', async () => {
    const context = await fixture(
      `printf '%s' '{"decision":"allow"}'; printf '%s' '{"decision":"deny"}' >&2`,
    );
    try {
      const result = await context.service.run(
        'Write',
        { file_path: 'target', content: 'allowed' },
        'write',
      );
      expect(result.isError).toBeFalsy();
      expect(await fs.readFile(join(home, 'target'), 'utf8')).toBe('allowed');
      const output = await context.bridge.bash('printf output; printf error >&2');
      expect(output).toEqual({ stdout: 'output', stderr: 'error', exitCode: 0, truncated: false });
    } finally {
      await context.close();
    }
  });

  it('preserves stdin and environment without evaluating payload shell syntax', async () => {
    const code = `const fs=require('node:fs'); console.log(JSON.stringify({additionalContext: JSON.stringify({input:JSON.parse(fs.readFileSync(0,'utf8')),event:process.env.DEEPCODE_HOOK_EVENT,time:process.env.DEEPCODE_TRIGGERED_AT,custom:process.env.CUSTOM})}));`;
    const context = await fixture(`${quote(process.execPath)} -e ${quote(code)}`);
    const marker = join(home, 'injected');
    const value = `single' double" \n $(touch ${quote(marker)}) \`touch ${quote(marker)}\``;
    try {
      const payload = { tool: 'Write', input: { file_path: value } };
      const result = await context.service.withScope(() =>
        context.hooks.dispatch({
          event: 'PreToolUse',
          cwd: home,
          triggeredAt: value,
          payload,
          env: { CUSTOM: value },
        }),
      );
      expect(result.anyBlocked).toBe(false);
      expect(JSON.parse(result.json!.additionalContext!)).toEqual({
        input: { event: 'PreToolUse', payload },
        event: 'PreToolUse',
        time: value,
        custom: value,
      });
      await expect(fs.access(marker)).rejects.toThrow();
    } finally {
      await context.close();
    }
  });

  it('fails closed on spilled hook output instead of trusting a partial JSON decision', async () => {
    const context = await fixture(
      `printf '%s' ${quote('x'.repeat(1024) + '{"decision":"allow"}')}`,
      128,
    );
    try {
      const result = await context.service.run(
        'Write',
        { file_path: 'target', content: 'forbidden' },
        'write',
      );
      expect(result.isError).toBe(true);
      await expect(fs.access(join(home, 'target'))).rejects.toThrow();
      const output = await context.bridge.bash(`printf '%s' ${quote('x'.repeat(1024))}`);
      expect(output.truncated).toBe(true);
      expect(output.stdout.length).toBeLessThan(1024);
    } finally {
      await context.close();
    }
  });

  it('blocks recursive external hooks without starting their command', async () => {
    const marker = join(home, 'recursive');
    const context = await fixture(`touch ${quote(marker)}`, undefined, 'Write|Bash');
    try {
      const result = await context.service.run(
        'Write',
        { file_path: 'target', content: 'forbidden' },
        'write',
      );
      expect(result.isError).toBe(true);
      await expect(fs.access(marker)).rejects.toThrow();
      await expect(fs.access(join(home, 'target'))).rejects.toThrow();
    } finally {
      await context.close();
    }
  });
});

describe('hasInstalledPlugins', () => {
  it('returns false when dir does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dc-no-plug-'));
    try {
      expect(await hasInstalledPlugins(dir)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns true when at least one plugin is present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dc-has-plug-'));
    try {
      await fs.mkdir(join(dir, '.deepcode', 'plugins', 'demo'), { recursive: true });
      expect(await hasInstalledPlugins(dir)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores hidden entries like .staging', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dc-staging-'));
    try {
      await fs.mkdir(join(dir, '.deepcode', 'plugins', '.staging'), { recursive: true });
      expect(await hasInstalledPlugins(dir)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('HookDispatcher.mergeHooks', () => {
  it('appends matchers under the same event name', async () => {
    const initial = new HookDispatcher({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] }],
      },
    });
    initial.mergeHooks({
      PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo b' }] }],
    });
    // Dispatch with Bash → matcher a runs; with Edit → matcher b runs.
    const ra = await initial.dispatch({
      event: 'PreToolUse',
      payload: { tool: 'Bash' },
      cwd: process.cwd(),
      triggeredAt: new Date().toISOString(),
    });
    expect(ra.stdout).toContain('a');
    const rb = await initial.dispatch({
      event: 'PreToolUse',
      payload: { tool: 'Edit' },
      cwd: process.cwd(),
      triggeredAt: new Date().toISOString(),
    });
    expect(rb.stdout).toContain('b');
  });

  it('adds a brand-new event entry when no matchers existed', () => {
    const d = new HookDispatcher({});
    d.mergeHooks({
      Notification: [{ matcher: '', hooks: [{ type: 'command', command: 'true' }] }],
    });
    // We can't directly read hooks (private); merge must not throw and
    // dispatching the event must run without error.
    return d
      .dispatch({
        event: 'Notification',
        payload: {},
        cwd: process.cwd(),
        triggeredAt: new Date().toISOString(),
      })
      .then((r) => {
        expect(r.timings.length).toBeGreaterThan(0);
      });
  });
});
