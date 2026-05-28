// Plugin wire-up — orchestrates discovery → spawn → register into live registries.
// Spec: docs/DEVELOPMENT_PLAN.md §3.14 + plugin-security.md §3.5
// Milestone: M5.2 (live registry wireup; OS sandbox of subprocess is M5.2-ext)
//
// The agent host calls `wirePlugins()` once at startup. It returns a handle
// that the host MUST `shutdown()` before exit, so child processes don't leak.
//
// What this does:
//   1. discoverPlugins() — scan ~/.deepcode/plugins/, verify hashes, skip disabled.
//   2. spawnAllPlugins() — start each enabled plugin in its own node subprocess.
//      Capability bridge (fs_read/fs_write/bash/fetch) routes through the host's
//      ToolRegistry, so plugin file/exec/net access is gated by mode + permission
//      + sandbox just like any other tool call.
//   3. Merge each plugin's `contributes.hooks` (from manifest) into the live
//      HookDispatcher.
//   4. Surface plugin-contributed status lines, modes, agents as metadata so
//      `/plugins` can list them. (Their actual *execution* awaits M5.2-rest.)

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import type { Hooks } from '../config/types.js';
import type { HookDispatcher } from '../hooks/dispatcher.js';
import type { ToolHandler } from '../types.js';
import {
  discoverPlugins,
  type DiscoverOptions,
  type InstalledPlugin,
} from './manifest.js';
import {
  PluginSubprocess,
  shutdownAllPlugins,
  spawnAllPlugins,
} from './runtime/subprocess.js';

export interface PluginCapabilityBridge {
  fs_read: (path: string) => Promise<string>;
  fs_write: (path: string, content: string) => Promise<void>;
  bash: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  fetch: (url: string, opts?: { method?: string; body?: string }) => Promise<string>;
}

export interface WirePluginsOpts {
  home?: string;
  /** Plugins disabled via settings.disabledPlugins. */
  disabled?: string[];
  /** Live hook dispatcher to merge plugin-contributed hooks into. */
  hooks: HookDispatcher;
  /** Capability bridge — required for the subprocess to call back into host. */
  capabilities: PluginCapabilityBridge;
  /**
   * Optional OS sandbox config — applied to each plugin's node subprocess.
   * When unset (or .enabled === false), plugins run unsandboxed.
   */
  sandbox?: import('../config/types.js').SandboxConfig;
  /**
   * Optional logger; defaults to writing to stderr. Avoids cluttering stdout
   * in headless mode where stdout is reserved for JSON output.
   */
  log?: (line: string) => void;
}

export interface WiredPlugin {
  plugin: InstalledPlugin;
  subprocess: PluginSubprocess;
  /** Hook events the plugin's manifest declared it contributes to. */
  contributedHookEvents: string[];
  /** Tool handlers (M5.2 keeps this empty — Skills cover this; M5.3 first-class tools). */
  contributedTools: ToolHandler[];
}

export interface WireResult {
  plugins: WiredPlugin[];
  /** Plugins discovered but skipped (hash drift, missing trust, etc.). */
  hashMismatches: string[];
  /** Discovered plugins that didn't spawn (e.g. crashed start). */
  spawnFailures: string[];
  /** Convenience: shutdown all spawned subprocesses. Idempotent. */
  shutdown: () => Promise<void>;
}

/**
 * Resolve and wire plugins for the current session.
 *
 * If no plugins are installed or the plugins dir doesn't exist, this returns
 * an empty WireResult with a no-op shutdown.
 */
export async function wirePlugins(opts: WirePluginsOpts): Promise<WireResult> {
  const home = opts.home ?? homedir();
  const log = opts.log ?? ((s: string) => process.stderr.write(s + '\n'));

  const discoverOpts: DiscoverOptions = { home, disabled: opts.disabled };
  const { plugins: discovered, hashMismatches } = await discoverPlugins(discoverOpts);
  if (discovered.length === 0) {
    return { plugins: [], hashMismatches, spawnFailures: [], shutdown: async () => {} };
  }

  // Spawn each enabled plugin
  const subprocesses = await spawnAllPlugins({
    plugins: discovered.filter((p) => p.enabled),
    host: opts.capabilities,
    sandbox: opts.sandbox,
  });

  // spawnAllPlugins returns successfully-started subprocesses, each exposing
  // its source plugin via the `.plugin` getter. Failed starts are dropped.
  const enabled = discovered.filter((p) => p.enabled);
  const successfulNames = new Set<string>();
  const wired: WiredPlugin[] = [];
  for (const sub of subprocesses) {
    const plugin = sub.plugin;
    successfulNames.add(plugin.manifest.name);
    const events = Object.keys(plugin.manifest.contributes?.hooks ?? {});
    wired.push({
      plugin,
      subprocess: sub,
      contributedHookEvents: events,
      contributedTools: sub.toolHandlers(),
    });
    // Merge declared hook matchers into the live dispatcher. The hooks
    // manifest from a plugin must follow the same shape as settings.hooks.
    const declared = plugin.manifest.contributes?.hooks;
    if (declared && Object.keys(declared).length > 0) {
      opts.hooks.mergeHooks(declared as Hooks);
    }
  }

  const spawnFailures: string[] = [];
  for (const p of enabled) {
    if (!successfulNames.has(p.manifest.name)) spawnFailures.push(p.manifest.name);
  }
  if (spawnFailures.length > 0) {
    log(`  ⊞ Plugins: ${spawnFailures.length} failed to start (${spawnFailures.join(', ')})`);
  }
  if (wired.length > 0) {
    const hookEventCount = wired.reduce((n, w) => n + w.contributedHookEvents.length, 0);
    log(`  ⊞ Plugins: ${wired.length} loaded · ${hookEventCount} hook event(s) contributed`);
  }

  let shut = false;
  const shutdown = async (): Promise<void> => {
    if (shut) return;
    shut = true;
    await shutdownAllPlugins(subprocesses);
  };

  return { plugins: wired, hashMismatches, spawnFailures, shutdown };
}

/**
 * Sanity helper exposed for tests / tools: returns whether a plugin dir is
 * present without spawning anything.
 */
export async function hasInstalledPlugins(home?: string): Promise<boolean> {
  const root = (home ?? homedir()) + '/.deepcode/plugins';
  try {
    const entries = await fs.readdir(root);
    return entries.some((e) => !e.startsWith('.'));
  } catch {
    return false;
  }
}
