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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HookDispatcher } from '../hooks/dispatcher.js';
import { computeSourceHash, pluginsDir, saveTrustState } from './manifest.js';
import { hasInstalledPlugins, wirePlugins } from './wireup.js';

async function makeInstalledPlugin(
  home: string,
  name: string,
  manifest: Record<string, unknown>,
  indexJs: string,
): Promise<void> {
  const dir = join(pluginsDir(home), name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, 'plugin.json'),
    JSON.stringify({ name, version: '0.0.1', ...manifest }, null, 2),
    'utf8',
  );
  await fs.writeFile(join(dir, 'index.js'), indexJs, 'utf8');
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
    // Mutate the index.js AFTER trust was recorded → hash drift
    // (computeSourceHash hashes plugin.json + skills/*/SKILL.md, NOT
    // index.js. So we need to mutate the manifest itself.)
    const manifestPath = join(pluginsDir(home), 'drifty', 'plugin.json');
    await fs.writeFile(manifestPath, JSON.stringify({ name: 'drifty', version: '0.0.2' }), 'utf8');

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
