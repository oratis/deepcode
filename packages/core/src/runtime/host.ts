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
  | 'pluginDirs';

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

  constructor(private readonly options: RuntimeHostOptions) {
    const policy = resolveRuntimePolicy(options);
    this.mode = policy.mode;
    this.permissions = policy.permissions;
  }

  run(turn: RuntimeTurnOptions): Promise<RunAgentResult> {
    const cwd = turn.cwd ?? this.options.cwd;
    if (!cwd) throw new Error('RuntimeHost requires cwd in the host or turn options');
    const { modeOverride, approval, ...agentTurn } = turn;
    return runAgent({
      ...agentTurn,
      provider: this.options.provider,
      tools: this.options.tools,
      cwd,
      mode: modeOverride ?? this.mode,
      permissions: this.permissions,
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
