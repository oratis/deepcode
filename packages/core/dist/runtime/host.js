import { runAgent, } from '../agent.js';
import { fileContractWarnings } from '../config/contract-dispatch.js';
import { loadFileContract } from '../config/file-contract-loader.js';
import { FileLedger, ledgerPath } from '../ledger/index.js';
import { buildRuntimeCapabilities } from './capabilities.js';
import { resolveSandboxMode } from '../sandbox/policy.js';
import { resolveRuntimePolicy } from './policy.js';
/**
 * Host-owned assembly boundary for the agent runtime. Clients provide turn
 * input, while provider/tool/policy/hook/sandbox services stay consistent.
 */
export class RuntimeHost {
    options;
    mode;
    permissions;
    /** Populated on first run; per-cwd because a turn may name its own. */
    contracts = new Map();
    ledgers = new Map();
    constructor(options) {
        this.options = options;
        const policy = resolveRuntimePolicy(options);
        this.mode = policy.mode;
        this.permissions = policy.permissions;
    }
    /**
     * Load (and cache) the contract for a workspace.
     *
     * The host does this rather than each client passing one in. Four clients
     * each remembering an optional argument is exactly the shape AGENTS.md rules
     * out for anything that gates tool execution.
     */
    async fileContract(cwd) {
        const dir = cwd ?? this.options.cwd;
        if (!dir)
            return { status: 'absent' };
        if (this.options.disableFileContract)
            return { status: 'absent' };
        const cached = this.contracts.get(dir);
        if (cached)
            return cached;
        const loaded = await loadFileContract({ cwd: dir, home: this.options.home });
        this.contracts.set(dir, loaded);
        return loaded;
    }
    /**
     * The audit sink for a workspace.
     *
     * Built here for the same reason the contract is: a client that forgets loses
     * the audit trail silently, and nobody notices until they need it.
     */
    ledgerFor(cwd) {
        if (this.options.disableLedger)
            return undefined;
        if (this.options.ledger)
            return this.options.ledger;
        const cached = this.ledgers.get(cwd);
        if (cached)
            return cached;
        const ledger = new FileLedger({ cwd, home: this.options.home });
        this.ledgers.set(cwd, ledger);
        return ledger;
    }
    /**
     * What this runtime may write and what it will always stop to ask about.
     *
     * Built through the shared builder so a client asking the CLI and a client
     * asking the app-server get the same answer for the same settings.
     */
    async capabilities(cwd) {
        const dir = cwd ?? this.options.cwd ?? process.cwd();
        const contract = await this.fileContract(dir);
        const ledgerEnabled = !this.options.disableLedger;
        return buildRuntimeCapabilities({
            cwd: dir,
            mode: this.mode,
            permissions: this.permissions,
            sandboxConfig: this.options.sandboxConfig,
            sandboxDefaultMode: this.options.sandboxDefaultMode ?? 'workspace-write',
            fileContract: contract.status,
            ledger: {
                enabled: ledgerEnabled,
                path: ledgerEnabled ? ledgerPath(dir, 'changes', this.options.home) : '',
            },
            modules: {
                hooks: !!this.options.hooks,
                plugins: (this.options.pluginDirs?.length ?? 0) > 0,
                ledger: ledgerEnabled,
                fileContract: contract.status === 'loaded',
            },
        });
    }
    /**
     * Operator warnings about how far the contract actually reaches, for hosts to
     * print at startup and for `deepcode doctor`.
     */
    async contractWarnings(cwd) {
        const loaded = await this.fileContract(cwd);
        return fileContractWarnings({
            ...loaded,
            sandboxMode: resolveSandboxMode(this.options.sandboxConfig, this.options.sandboxDefaultMode ?? 'workspace-write'),
        });
    }
    /**
     * Not `async`: the missing-cwd check is a programming error and has always
     * thrown synchronously. Making the whole method async would quietly turn that
     * throw into a rejection and change what callers catch, so the async work
     * lives in `runWithContract` behind a synchronous guard.
     */
    run(turn) {
        const cwd = turn.cwd ?? this.options.cwd;
        if (!cwd)
            throw new Error('RuntimeHost requires cwd in the host or turn options');
        return this.runWithContract(turn, cwd);
    }
    async runWithContract(turn, cwd) {
        const { modeOverride, approval, ...agentTurn } = turn;
        const contract = (await this.fileContract(cwd)).contract;
        return runAgent({
            ...agentTurn,
            provider: this.options.provider,
            tools: this.options.tools,
            cwd,
            mode: modeOverride ?? this.mode,
            permissions: this.permissions,
            contract,
            ledger: this.ledgerFor(cwd),
            hooks: this.options.hooks,
            approval: approval ?? this.options.approval,
            autoMode: this.options.autoMode,
            sandboxConfig: this.options.sandboxConfig,
            sandboxDefaultMode: this.options.sandboxDefaultMode ?? 'workspace-write',
            pluginDirs: this.options.pluginDirs,
        });
    }
}
export function createRuntimeHost(options) {
    return new RuntimeHost(options);
}
//# sourceMappingURL=host.js.map