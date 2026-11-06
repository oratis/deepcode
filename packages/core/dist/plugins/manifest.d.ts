import type { McpServerConfig } from '../config/types.js';
export interface PluginManifest {
    name: string;
    version: string;
    description?: string;
    author?: string;
    engines?: {
        deepcode?: string;
    };
    contributes?: {
        skills?: string[];
        commands?: Array<{
            name: string;
            skill?: string;
            prompt?: string;
        }>;
        hooks?: Record<string, unknown>;
        mcpServers?: Record<string, unknown>;
        agents?: string[];
        statusLines?: Array<{
            name: string;
            command: string;
        }>;
        modes?: Array<{
            name: string;
            policy: Record<string, unknown>;
        }>;
    };
}
export interface InstalledPlugin {
    manifest: PluginManifest;
    /** Absolute path to the plugin directory. */
    path: string;
    /** SHA-256 of the manifest + skill files (truncated to 16 hex). */
    sourceHash: string;
    /** Whether the plugin is enabled in settings. */
    enabled: boolean;
}
export interface PluginTrust {
    version: string;
    installedAt: string;
    sourceHash: string;
    /** How this plugin entered the user's trust. */
    trustedBy: 'user' | 'marketplace' | 'official';
    /** Optional marketplace name. */
    marketplaceVerified?: string;
}
export interface TrustState {
    plugins: Record<string, PluginTrust>;
}
export declare function pluginsDir(home: string, directory?: string): string;
export declare function trustFilePath(home: string, directory?: string): string;
/** Compute a deterministic trust hash over every installed plugin file. */
export declare function computeSourceHash(pluginPath: string): Promise<string>;
export declare function readManifest(pluginPath: string): Promise<PluginManifest>;
export declare function loadTrustState(home: string, directory?: string): Promise<TrustState>;
export declare function saveTrustState(home: string, state: TrustState, directory?: string): Promise<void>;
export interface InstallOptions {
    sourcePath: string;
    home?: string;
    trustedBy?: PluginTrust['trustedBy'];
}
/**
 * Copy a local plugin into ~/.deepcode/plugins/<name>/ and record trust.
 * Returns the InstalledPlugin on success.
 */
export declare function installLocal(opts: InstallOptions): Promise<InstalledPlugin>;
export interface DiscoverOptions {
    home?: string;
    /** Direct DeepCode data directory (contains plugins/ and plugins-trust.json). */
    directory?: string;
    /** Plugins disabled in settings (settings.disabledPlugins). */
    disabled?: string[];
}
/**
 * Scan ~/.deepcode/plugins/ for installed plugins and verify hash pinning.
 * Plugins whose hash drifted from the trust manifest are SKIPPED (returned with enabled=false).
 */
export declare function discoverPlugins(opts?: DiscoverOptions): Promise<{
    plugins: InstalledPlugin[];
    hashMismatches: string[];
}>;
/**
 * Collect the live contributions of trusted+enabled plugins for the host to
 * wire in: their directories (for skill / sub-agent / command loaders, which
 * read `<dir>/{skills,agents,commands}`) and their contributed `mcpServers`.
 * Hooks are merged separately by wirePlugins (it needs the live dispatcher).
 */
export declare function collectPluginContributions(opts?: {
    home?: string;
    directory?: string;
    disabled?: string[];
}): Promise<{
    dirs: string[];
    mcpServers: Record<string, McpServerConfig>;
}>;
//# sourceMappingURL=manifest.d.ts.map