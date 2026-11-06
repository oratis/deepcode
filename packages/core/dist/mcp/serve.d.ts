import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { FileContract } from '../config/file-contract.js';
import type { AutoModeConfig, PermissionRules } from '../config/types.js';
import type { HookDispatcher } from '../hooks/index.js';
import type { Mode, ToolContext, ToolHandler } from '../types.js';
/** The verdict for one MCP tool call. `allowed: false` is returned to the peer. */
export interface McpGateVerdict {
    allowed: boolean;
    reason: string;
}
export type McpToolGate = (req: {
    tool: string;
    input: Record<string, unknown>;
}) => Promise<McpGateVerdict>;
export interface McpGateOptions {
    cwd: string;
    mode: Mode;
    permissions?: PermissionRules;
    contract?: FileContract;
    hooks?: HookDispatcher;
    autoMode?: AutoModeConfig;
}
/**
 * The gate every served tool call goes through.
 *
 * `mcp serve` hands Read/Write/Edit/Bash to whatever MCP client connected. There
 * is no human on this side of the pipe, so `ask` cannot be asked and resolves to
 * a refusal — the same fail-closed rule an unattended cron run follows. A peer
 * that wants more has to be granted it in `settings.json`, where it is written
 * down and reviewable, rather than by being the one who connected.
 */
export declare function buildMcpGate(options: McpGateOptions): McpToolGate;
/** Tools that can't run statelessly over MCP (need host-interactive context). */
export declare const MCP_SERVE_EXCLUDE: Set<string>;
/** The subset of `tools` that is safe to expose over an MCP stdio server. */
export declare function mcpServableTools(tools?: ToolHandler[]): ToolHandler[];
export interface BuildMcpServerOpts {
    /** Project directory tools resolve relative paths against. */
    cwd: string;
    /**
     * Policy gate for every call. **Required** — this server used to execute
     * Read/Write/Edit/Bash for any connected peer with no mode, no permission
     * rules, no file contract and no PreToolUse hooks. Making it required is the
     * point: safety must not depend on a host remembering an optional argument.
     * Build one with `buildMcpGate`.
     */
    gate: McpToolGate;
    /** Override the served tool set (default: stateless BUILTIN_TOOLS). */
    tools?: ToolHandler[];
    name?: string;
    version?: string;
    /** Abort signal propagated into each tool's ToolContext. */
    signal?: AbortSignal;
    /** Optional sandbox config forwarded to the Bash tool. */
    sandboxConfig?: ToolContext['sandboxConfig'];
    /** Path-axis rules, so Grep/Glob filter their results here too. */
    contract?: FileContract;
}
/**
 * Build (but don't connect) an MCP `Server` that lists + executes the given
 * tools. Returned unconnected so callers can attach any transport — stdio in
 * production, an in-memory pair in tests.
 */
export declare function buildMcpServer(opts: BuildMcpServerOpts): Server;
export interface ServeMcpStdioOpts extends BuildMcpServerOpts {
    /** Called once the transport is connected (log to stderr, never stdout). */
    onReady?: (toolNames: string[]) => void;
}
/**
 * Build the server and serve it over stdio. Resolves when the transport closes
 * (peer disconnects / stdin EOF). stdout is the JSON-RPC channel — callers MUST
 * NOT write anything else to it.
 */
export declare function serveMcpOverStdio(opts: ServeMcpStdioOpts): Promise<void>;
//# sourceMappingURL=serve.d.ts.map