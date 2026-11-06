import type { Hooks } from '../config/types.js';
import type { HookContext, HookHandlerOutput, HookResult } from './types.js';
export interface HookDispatcherOpts {
    hooks?: Hooks;
    disableAllHooks?: boolean;
    /** Default handler timeout if not specified. */
    defaultTimeoutMs?: number;
    /** http hook URLs allowed (prefix match). Empty array = allow all. */
    allowedHttpHookUrls?: string[];
    /**
     * Callback to dispatch an mcp_tool hook. Wired by the CLI bootstrap with
     * the live MCP client. Receives the handler config + the hook payload;
     * returns whatever the MCP tool emitted (stringified for stdout).
     */
    mcpToolDispatcher?: (handler: {
        server: string;
        tool: string;
        arguments?: Record<string, unknown>;
    }, payload: unknown) => Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
    /**
     * Callback to dispatch a sub-agent hook. Receives the handler's agent name +
     * payload and returns the sub-agent's stdout. Wired by the CLI bootstrap
     * once sub-agents are loadable.
     */
    agentDispatcher?: (handler: {
        agent: string;
        prompt?: string;
    }, payload: unknown) => Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
}
export declare class HookDispatcher {
    private hooks;
    private readonly disabled;
    private readonly defaultTimeoutMs;
    private readonly allowedHttpHookUrls?;
    private mcpToolDispatcher?;
    private agentDispatcher?;
    constructor(opts: HookDispatcherOpts);
    /**
     * Wire the `mcp_tool` hook handler. The agent loop calls this with a closure
     * that resolves the requested MCP tool from its registry — the construction
     * site (CLI host) doesn't yet have the live registry, so it can't pass one in.
     * No-ops if a dispatcher was already supplied (constructor wins).
     */
    setMcpToolDispatcher(fn: NonNullable<HookDispatcherOpts['mcpToolDispatcher']>): void;
    hasMcpToolDispatcher(): boolean;
    /**
     * Wire the `agent` hook handler (runs a named sub-agent on the event). Set by
     * the agent loop using its sub-agent runner. No-ops if already set.
     */
    setAgentDispatcher(fn: NonNullable<HookDispatcherOpts['agentDispatcher']>): void;
    hasAgentDispatcher(): boolean;
    /**
     * Merge additional hook matchers into the dispatcher (e.g. from plugins).
     * Matchers under the same event name are appended in order.
     */
    mergeHooks(extra: Hooks): void;
    /**
     * Dispatch all hooks for an event. Handlers run sequentially (not in parallel) so
     * that later handlers can see the side effects of earlier ones.
     */
    dispatch(ctx: HookContext): Promise<HookResult>;
    private matcherApplies;
    private runHandler;
    private runCommandHandler;
    private runHttpHandler;
}
interface RunCommandOpts {
    command: string;
    cwd: string;
    timeoutMs: number;
    env: Record<string, string | undefined>;
    stdin?: string;
}
export declare function runCommand(opts: RunCommandOpts): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
}>;
/** Extract a JSON object from handler stdout, if any. Returns null on parse failure. */
export declare function tryParseJsonOutput(stdout: string): HookHandlerOutput | null;
export {};
//# sourceMappingURL=dispatcher.d.ts.map