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
import { discoverPlugins } from './manifest.js';
import { shutdownAllPlugins, spawnAllPlugins } from './runtime/subprocess.js';
/**
 * Resolve and wire plugins for the current session.
 *
 * If no plugins are installed or the plugins dir doesn't exist, this returns
 * an empty WireResult with a no-op shutdown.
 */
export async function wirePlugins(opts) {
    const home = opts.home ?? homedir();
    const log = opts.log ?? ((s) => process.stderr.write(s + '\n'));
    const discoverOpts = {
        home,
        directory: opts.directory,
        disabled: opts.disabled,
    };
    const { plugins: discovered, hashMismatches } = await discoverPlugins(discoverOpts);
    if (discovered.length === 0) {
        return { plugins: [], hashMismatches, spawnFailures: [], shutdown: async () => { } };
    }
    // A skills/MCP/hooks-only plugin is valid and does not need a subprocess.
    const enabled = discovered.filter((p) => p.enabled);
    const runnable = [];
    for (const plugin of enabled) {
        try {
            await fs.access(`${plugin.path}/index.js`);
            runnable.push(plugin);
        }
        catch {
            // No executable runtime; declarative contributions remain active.
        }
    }
    // Spawn each enabled plugin that declares executable code via index.js.
    const subprocesses = await spawnAllPlugins({
        plugins: runnable,
        host: opts.capabilities,
        sandbox: opts.sandbox,
    });
    try {
        // spawnAllPlugins returns successfully-started subprocesses, each exposing
        // its source plugin via the `.plugin` getter. Failed starts are dropped.
        const successfulNames = new Set();
        const wired = [];
        for (const sub of subprocesses) {
            successfulNames.add(sub.plugin.manifest.name);
        }
        for (const plugin of enabled) {
            const sub = subprocesses.find((candidate) => candidate.plugin.manifest.name === plugin.manifest.name);
            const events = Object.keys(plugin.manifest.contributes?.hooks ?? {});
            wired.push({
                plugin,
                subprocess: sub,
                contributedHookEvents: events,
                contributedTools: sub?.toolHandlers() ?? [],
            });
            // Merge declared hook matchers into the live dispatcher. The hooks
            // manifest from a plugin must follow the same shape as settings.hooks.
            const declared = plugin.manifest.contributes?.hooks;
            if (declared && Object.keys(declared).length > 0) {
                opts.hooks.mergeHooks(declared);
            }
        }
        const spawnFailures = [];
        for (const p of runnable) {
            if (!successfulNames.has(p.manifest.name))
                spawnFailures.push(p.manifest.name);
        }
        if (spawnFailures.length > 0) {
            log(`  ⊞ Plugins: ${spawnFailures.length} failed to start (${spawnFailures.join(', ')})`);
        }
        if (wired.length > 0) {
            const hookEventCount = wired.reduce((n, w) => n + w.contributedHookEvents.length, 0);
            log(`  ⊞ Plugins: ${wired.length} loaded · ${hookEventCount} hook event(s) contributed`);
        }
        let shut = false;
        const shutdown = async () => {
            if (shut)
                return;
            shut = true;
            await shutdownAllPlugins(subprocesses);
        };
        return { plugins: wired, hashMismatches, spawnFailures, shutdown };
    }
    catch (error) {
        await shutdownAllPlugins(subprocesses);
        throw error;
    }
}
/**
 * Sanity helper exposed for tests / tools: returns whether a plugin dir is
 * present without spawning anything.
 */
export async function hasInstalledPlugins(home, directory) {
    const root = directory ? `${directory}/plugins` : `${home ?? homedir()}/.deepcode/plugins`;
    try {
        const entries = await fs.readdir(root);
        return entries.some((e) => !e.startsWith('.'));
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=wireup.js.map