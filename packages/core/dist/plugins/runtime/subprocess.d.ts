import type { SandboxConfig } from '../../config/types.js';
import type { InstalledPlugin } from '../manifest.js';
import type { ToolHandler } from '../../types.js';
export interface RpcRequest {
    id: string;
    method: string;
    params: Record<string, unknown>;
}
export interface RpcResponse {
    id: string;
    result?: unknown;
    error?: {
        code: number;
        message: string;
    };
}
export interface PluginSubprocessOpts {
    plugin: InstalledPlugin;
    /** Token the host generates and verifies on every RPC. */
    token: string;
    /** Bridge to host's existing tool dispatcher / fs primitives. */
    host: {
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
    };
    /** Optional OS-level sandbox config — wraps the node subprocess under
     *  sandbox-exec (macOS) or bwrap (Linux). M5.1-ext. */
    sandbox?: SandboxConfig;
}
/**
 * Spawn a plugin's `index.js` entry point as a subprocess.
 * Plugin's main reads RPC requests from stdin (one JSON object per line)
 * and writes results to stdout.
 *
 * Returns a handle exposing the tools the plugin contributes.
 */
export declare class PluginSubprocess {
    private readonly opts;
    private child;
    private pendingRequests;
    private buffer;
    private nextId;
    private alive;
    constructor(opts: PluginSubprocessOpts);
    /** Read-only accessor for the plugin metadata this subprocess wraps. */
    get plugin(): InstalledPlugin;
    /** Whether the child process is currently running. */
    get isAlive(): boolean;
    start(): Promise<void>;
    stop(): Promise<void>;
    /**
     * Send an RPC request to the plugin and await its response.
     * Used to drive plugin code from the host (e.g. invoke a plugin-contributed tool).
     */
    invoke<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
    /**
     * Convert plugin-contributed tool definitions (loaded from skills/) into
     * ToolHandler instances that proxy invocation through this subprocess.
     */
    toolHandlers(): ToolHandler[];
    private drainBuffer;
    private handleLine;
    private handlePluginRequest;
    private respond;
}
/**
 * Trivial unguessable token for host↔plugin RPC validation.
 */
export declare function generatePluginToken(): string;
/**
 * Convenience: spawn all enabled plugins from settings.
 * `host` provides the capability bridge — typically wired by the agent loop
 * owner so plugin calls go through mode/permission/sandbox gates.
 */
export interface SpawnAllOpts {
    plugins: InstalledPlugin[];
    host: PluginSubprocessOpts['host'];
    sandbox?: SandboxConfig;
}
export declare function spawnAllPlugins(opts: SpawnAllOpts): Promise<PluginSubprocess[]>;
export declare function shutdownAllPlugins(handles: PluginSubprocess[]): Promise<void>;
//# sourceMappingURL=subprocess.d.ts.map