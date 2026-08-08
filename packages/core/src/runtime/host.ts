import {
  runAgent,
  type ApprovalCallback,
  type RunAgentOptions,
  type RunAgentResult,
} from '../agent.js';
import type {
  AutoModeConfig,
  PermissionRules,
  SandboxConfig,
  SandboxMode,
} from '../config/types.js';
import { fileContractWarnings } from '../config/contract-dispatch.js';
import { loadFileContract, type LoadedFileContract } from '../config/file-contract-loader.js';
import { FileLedger, ledgerPath, type LedgerSink } from '../ledger/index.js';
import { buildRuntimeCapabilities, type RuntimeCapabilities } from './capabilities.js';
import { resolveSandboxMode } from '../sandbox/policy.js';
import type { HookDispatcher } from '../hooks/index.js';
import type { Provider } from '../providers/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Mode } from '../types.js';
import { resolveRuntimePolicy } from './policy.js';

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

type HostBoundOption =
  | 'provider'
  | 'tools'
  | 'mode'
  | 'permissions'
  | 'hooks'
  | 'approval'
  | 'autoMode'
  | 'sandboxConfig'
  | 'sandboxDefaultMode'
  | 'pluginDirs'
  | 'contract'
  | 'ledger';

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
export class RuntimeHost {
  readonly mode: Mode;
  readonly permissions: PermissionRules;
  /** Populated on first run; per-cwd because a turn may name its own. */
  private readonly contracts = new Map<string, LoadedFileContract>();
  private readonly ledgers = new Map<string, LedgerSink>();

  constructor(private readonly options: RuntimeHostOptions) {
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
  async fileContract(cwd?: string): Promise<LoadedFileContract> {
    const dir = cwd ?? this.options.cwd;
    if (!dir) return { status: 'absent' };
    if (this.options.disableFileContract) return { status: 'absent' };
    const cached = this.contracts.get(dir);
    if (cached) return cached;
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
  ledgerFor(cwd: string): LedgerSink | undefined {
    if (this.options.disableLedger) return undefined;
    if (this.options.ledger) return this.options.ledger;
    const cached = this.ledgers.get(cwd);
    if (cached) return cached;
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
  async capabilities(cwd?: string): Promise<RuntimeCapabilities> {
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
  async contractWarnings(cwd?: string): Promise<string[]> {
    const loaded = await this.fileContract(cwd);
    return fileContractWarnings({
      ...loaded,
      sandboxMode: resolveSandboxMode(
        this.options.sandboxConfig,
        this.options.sandboxDefaultMode ?? 'workspace-write',
      ),
    });
  }

  /**
   * Not `async`: the missing-cwd check is a programming error and has always
   * thrown synchronously. Making the whole method async would quietly turn that
   * throw into a rejection and change what callers catch, so the async work
   * lives in `runWithContract` behind a synchronous guard.
   */
  run(turn: RuntimeTurnOptions): Promise<RunAgentResult> {
    const cwd = turn.cwd ?? this.options.cwd;
    if (!cwd) throw new Error('RuntimeHost requires cwd in the host or turn options');
    return this.runWithContract(turn, cwd);
  }

  private async runWithContract(turn: RuntimeTurnOptions, cwd: string): Promise<RunAgentResult> {
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

export function createRuntimeHost(options: RuntimeHostOptions): RuntimeHost {
  return new RuntimeHost(options);
}
