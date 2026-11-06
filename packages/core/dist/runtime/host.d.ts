import { type ApprovalCallback, type RunAgentOptions, type RunAgentResult } from '../agent.js';
import type { AutoModeConfig, PermissionRules, SandboxConfig, SandboxMode } from '../config/types.js';
import { type LoadedFileContract } from '../config/file-contract-loader.js';
import { type LedgerSink } from '../ledger/index.js';
import { type RuntimeCapabilities } from './capabilities.js';
import type { HookDispatcher } from '../hooks/index.js';
import type { Provider } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Mode } from '../types.js';
export interface RuntimeHostOptions {
    provider: Provider;
    tools: ToolRegistry;
    /** Default working directory; a turn may override it explicitly. */
    cwd?: string;
    /** Safe fallback is `default`, even for untyped callers. */
    mode?: Mode;
    permissions?: PermissionRules;
    hooks?: HookDispatcher;
    approval?: ApprovalCallback;
    autoMode?: AutoModeConfig;
    sandboxConfig?: SandboxConfig;
    /**
     * Sandbox mode when settings name none. Every host gets `workspace-write`:
     * commands may write inside the workspace and temp/cache dirs, and nowhere
     * else. Pass `'danger-full-access'` to opt a host out.
     */
    sandboxDefaultMode?: SandboxMode;
    pluginDirs?: string[];
    /**
     * Override $HOME when looking for a user-level file contract (tests).
     */
    home?: string;
    /**
     * Skip loading the file contract. Only for callers that have no workspace to
     * read it from; every real host wants the default.
     */
    disableFileContract?: boolean;
    /** Substitute audit sink; the host builds a FileLedger when absent. */
    ledger?: LedgerSink;
    /** Turn off change recording entirely. */
    disableLedger?: boolean;
}
type HostBoundOption = 'provider' | 'tools' | 'mode' | 'permissions' | 'hooks' | 'approval' | 'autoMode' | 'sandboxConfig' | 'sandboxDefaultMode' | 'pluginDirs' | 'contract' | 'ledger';
export type RuntimeTurnOptions = Omit<RunAgentOptions, HostBoundOption | 'cwd'> & {
    cwd?: string;
    /** Explicit per-turn mode change; all other safety services remain host-owned. */
    modeOverride?: Mode;
    /** Per-turn UI callback; omission remains fail-closed for `ask` decisions. */
    approval?: ApprovalCallback;
};
/**
 * Host-owned assembly boundary for the agent runtime. Clients provide turn
 * input, while provider/tool/policy/hook/sandbox services stay consistent.
 */
export declare class RuntimeHost {
    private readonly options;
    readonly mode: Mode;
    readonly permissions: PermissionRules;
    /** Populated on first run; per-cwd because a turn may name its own. */
    private readonly contracts;
    private readonly ledgers;
    constructor(options: RuntimeHostOptions);
    /**
     * Load (and cache) the contract for a workspace.
     *
     * The host does this rather than each client passing one in. Four clients
     * each remembering an optional argument is exactly the shape AGENTS.md rules
     * out for anything that gates tool execution.
     */
    fileContract(cwd?: string): Promise<LoadedFileContract>;
    /**
     * The audit sink for a workspace.
     *
     * Built here for the same reason the contract is: a client that forgets loses
     * the audit trail silently, and nobody notices until they need it.
     */
    ledgerFor(cwd: string): LedgerSink | undefined;
    /**
     * What this runtime may write and what it will always stop to ask about.
     *
     * Built through the shared builder so a client asking the CLI and a client
     * asking the app-server get the same answer for the same settings.
     */
    capabilities(cwd?: string): Promise<RuntimeCapabilities>;
    /**
     * Operator warnings about how far the contract actually reaches, for hosts to
     * print at startup and for `deepcode doctor`.
     */
    contractWarnings(cwd?: string): Promise<string[]>;
    /**
     * Not `async`: the missing-cwd check is a programming error and has always
     * thrown synchronously. Making the whole method async would quietly turn that
     * throw into a rejection and change what callers catch, so the async work
     * lives in `runWithContract` behind a synchronous guard.
     */
    run(turn: RuntimeTurnOptions): Promise<RunAgentResult>;
    private runWithContract;
}
export declare function createRuntimeHost(options: RuntimeHostOptions): RuntimeHost;
export {};
//# sourceMappingURL=host.d.ts.map