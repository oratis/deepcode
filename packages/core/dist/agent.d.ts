import type { PermissionRules } from './config/types.js';
import type { FileContract } from './config/file-contract.js';
import type { UnattendedApprovalPolicy } from './cron/index.js';
import type { LedgerSink } from './ledger/index.js';
import { type RepeatGuardOptions, type ToolDeadlineConfig } from './guard/index.js';
import { type DispatchVerdict } from './harness/tool-dispatcher.js';
import { TaskManager } from './tasks/manager.js';
import type { HookDispatcher } from './hooks/index.js';
import type { Mode } from './types.js';
import type { Provider } from './providers/types.js';
import { type SpillStore } from './spill/index.js';
import { ShellRegistry } from './shell/registry.js';
import type { ReminderType } from './reminders/index.js';
import type { SessionManager } from './sessions/index.js';
import type { ToolRegistry } from './tools/registry.js';
import type { AgentEvent, StoredMessage, ToolContext } from './types.js';
/**
 * Approval callback — return value semantics:
 *   - `true`     allow this one call
 *   - `false`    reject this one call
 *   - `'always'` allow this one call AND persist a matcher to
 *                `settings.local.json#permissions.allow` so future calls of
 *                the same tool skip the prompt. The host is responsible for
 *                the persist step (call `appendAllowMatcher` from
 *                `@deepcode/core/config`); the agent loop only treats
 *                `'always'` as allow-for-this-call.
 * Called when dispatcher returns 'ask'.
 */
export type ApprovalDecision = boolean | 'always';
export type ApprovalCallback = (toolName: string, toolInput: Record<string, unknown>, verdict: DispatchVerdict) => Promise<ApprovalDecision> | ApprovalDecision;
export interface RunAgentOptions {
    provider: Provider;
    tools: ToolRegistry;
    systemPrompt: string;
    history?: StoredMessage[];
    userMessage?: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
    /** Caps the number of provider round-trips per `run()` call. */
    maxTurns?: number;
    cwd: string;
    signal?: AbortSignal;
    onEvent?: (event: AgentEvent) => void;
    /** Optional: persist each turn to a session. */
    session?: {
        manager: SessionManager;
        id: string;
        turnId?: string;
    };
    /** Keep session-backed snapshots while another owner materializes messages. */
    persistSessionMessages?: boolean;
    /** Optional: snapshot files before/after Edit/Write tool calls. */
    enableSnapshots?: boolean;
    /** Optional host-owned per-turn tool ceiling; omitted means the full registry. */
    allowedTools?: string[];
    /** Required dispatch mode. Every tool call goes through the central gate. */
    mode: Mode;
    permissions?: PermissionRules;
    /** Path-axis rules; RuntimeHost loads this so clients need not remember to. */
    contract?: FileContract;
    /** Audit sink for completed mutations. RuntimeHost supplies one by default. */
    ledger?: LedgerSink;
    hooks?: HookDispatcher;
    approval?: ApprovalCallback;
    /**
     * Declares that no human can answer an approval prompt for this run (cron,
     * headless CI). Hosts state it rather than letting the loop infer it from a
     * missing callback: headless installs an auto-deny `approval`, so absence of
     * a callback is not the same question as absence of a human.
     */
    unattended?: boolean;
    /**
     * What an unattended run does when a call resolves to `ask`. Defaults to
     * `deny` — refuse that call, continue the run — which is what every host did
     * before this option existed. `abort` ends the run instead.
     */
    onApprovalRequired?: UnattendedApprovalPolicy;
    /** AutoModeConfig from settings.autoMode — used when mode === 'auto'. */
    autoMode?: import('./config/types.js').AutoModeConfig;
    /** M3.5: passed through to Bash tool ctx for sandbox wrapping. */
    sandboxConfig?: import('./config/types.js').SandboxConfig;
    /** Sandbox mode applied when settings name none. Hosts pass workspace-write. */
    sandboxDefaultMode?: import('./config/types.js').SandboxMode;
    /** M3c: auto-compact when cumulative tokens approach contextWindow * threshold.
     *  When triggered, runs the summarizer call and replaces history mid-loop. */
    autoCompact?: {
        contextWindow: number;
        threshold?: number;
        summarizerModel?: string;
        keepFirstPairs?: number;
        keepLastMessages?: number;
    };
    /** Inject system reminders before the user message (date, todos, etc).
     *  Pass `false` to disable; pass a partial list to limit which builders run. */
    systemReminders?: false | {
        enabled?: ReminderType[];
    };
    /** Model-visible ceiling per tool result, in code units. See `spill/policy.ts`. */
    spillThresholdChars?: number;
    /**
     * Where oversized tool output is persisted. Hosts with a session directory
     * get the local file store by default; supplying one here overrides that,
     * and it is the seam tests use.
     */
    spillStore?: SpillStore;
    /** Nudge the model when it repeats an identical tool call. `false` disables it. */
    repeatGuard?: false | RepeatGuardOptions;
    /** Backstop deadline for a tool call that never returns. See `guard/tool-deadline.ts`. */
    toolDeadlines?: ToolDeadlineConfig;
    /** How far SessionSearch may reach. User setting, not a tool argument. */
    sessionSearchScope?: import('./sessions/search.js').SessionSearchScope;
    /** Host callback for AskUserQuestion tool. Optional — when absent the tool
     *  errors. */
    askUser?: NonNullable<ToolContext['askUser']>;
    /** Internal: sub-agent recursion depth (the Task tool). 0 = top-level agent.
     *  Sub-agents run at depth 1 and are NOT given a runSubAgent, so they can't
     *  spawn further sub-agents. */
    subAgentDepth?: number;
    /** Installed-plugin directories — so the Task tool can resolve plugin-bundled
     *  sub-agents (`<dir>/agents/*.md`) in addition to user/project ones. */
    pluginDirs?: string[];
    /**
     * Host-owned registry for shells that outlive one tool call. When set, shells
     * survive across runs and the host is responsible for closing them. When
     * absent, this run owns one and closes every shell before it returns, so no
     * shell can outlive the run that opened it.
     */
    shells?: ShellRegistry;
    /** Optional host-owned background-task manager (e.g. the REPL's session-scoped
     *  one). When set, this run attaches its sub-agent runner to it and exposes it
     *  on the tool context, so background tasks persist across runAgent calls and
     *  are visible to slash commands. When absent, a per-run manager is created
     *  (the original behavior). Top-level only. */
    taskManager?: TaskManager;
}
export interface RunAgentResult {
    /** Final history (input history + everything appended this run). */
    history: StoredMessage[];
    /** Total provider round-trips executed. */
    turnsUsed: number;
    /** Aggregate token usage. */
    usage: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens: number;
        cacheReadTokens: number;
    };
    /**
     * Reason the loop terminated. `blocked` means an unattended run hit a call
     * needing approval while configured with `onApprovalRequired: 'abort'`.
     */
    stopReason: 'end_turn' | 'max_turns' | 'aborted' | 'error' | 'blocked';
    /** Mode-control signals flipped by tools during this run (M3c-rest). */
    modeSignal?: {
        exitPlanMode?: boolean;
        enterPlanMode?: boolean;
    };
}
/**
 * Runs the agent loop until the model produces an end_turn (no tool calls),
 * or `maxTurns` is reached, or the abort signal fires.
 */
/**
 * Run the agent loop.
 *
 * When the caller supplies no {@link RunAgentOptions.shells}, this run owns a
 * registry and closes every shell it opened before returning — including when
 * the loop throws. Leaving live shell processes behind after a crashed run is
 * the failure this wrapper exists to make impossible.
 *
 * @param opts Everything the loop needs.
 * @returns The final history, usage, and stop reason.
 */
export declare function runAgent(opts: RunAgentOptions): Promise<RunAgentResult>;
export declare const AGENT_MODULE_VERSION = "0.1.0";
//# sourceMappingURL=agent.d.ts.map