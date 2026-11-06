import type { HookDispatcher } from '../hooks/dispatcher.js';
import type { ToolHandler } from '../types.js';
import { type InstalledPlugin } from './manifest.js';
import { PluginSubprocess } from './runtime/subprocess.js';
export interface PluginCapabilityBridge {
    fs_read: (path: string) => Promise<string>;
    fs_write: (path: string, content: string) => Promise<void>;
    bash: (cmd: string) => Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
    fetch: (url: string, opts?: {
        method?: string;
        body?: string;
    }) => Promise<string>;
}
export interface WirePluginsOpts {
    home?: string;
    /** Direct DeepCode data directory (contains plugins/ and plugins-trust.json). */
    directory?: string;
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
    /** Present only when the plugin has an executable index.js runtime. */
    subprocess?: PluginSubprocess;
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
export declare function wirePlugins(opts: WirePluginsOpts): Promise<WireResult>;
/**
 * Sanity helper exposed for tests / tools: returns whether a plugin dir is
 * present without spawning anything.
 */
export declare function hasInstalledPlugins(home?: string, directory?: string): Promise<boolean>;
//# sourceMappingURL=wireup.d.ts.map