// Agent loop — orchestrates provider <-> tools <-> session.
// Spec: docs/DEVELOPMENT_PLAN.md §3.1 / §3.15

import { compact, shouldCompact } from './compaction/index.js';
import type { PermissionRules } from './config/types.js';
import type { FileContract } from './config/file-contract.js';
import type { UnattendedApprovalPolicy } from './cron/index.js';
import type { LedgerSink } from './ledger/index.js';
import {
  RepeatToolGuard,
  type RepeatGuardOptions,
  type ToolDeadlineConfig,
} from './guard/index.js';
import type { DispatchVerdict } from './harness/tool-dispatcher.js';
import { ToolExecutionService, type PreparedToolCall } from './runtime/tool-execution.js';
import { TaskManager, type TaskRunner } from './tasks/manager.js';
import type { HookDispatcher } from './hooks/index.js';
import type { Mode } from './types.js';
import type { Provider } from './providers/types.js';
import { resolveRuntimePolicy } from './runtime/policy.js';
import type { SpillStore } from './spill/index.js';
import { ShellRegistry } from './shell/registry.js';
// NOTE: reminders + sessions are lazy-loaded inside the loop so a browser
// build (Tauri renderer) that doesn't use them avoids pulling node:fs at
// module-load time. See `loadRemindersIfEnabled` and `appendSessionIfSet`.
import type { ReminderType } from './reminders/index.js';
import type { SessionManager } from './sessions/index.js';
import type { ToolRegistry } from './tools/registry.js';
import type {
  AgentEvent,
  ContentBlock,
  StoredMessage,
  ToolContext,
  ToolResultBlock,
  ToolUseBlock,
} from './types.js';

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
export type ApprovalCallback = (
  toolName: string,
  toolInput: Record<string, unknown>,
  verdict: DispatchVerdict,
) => Promise<ApprovalDecision> | ApprovalDecision;

export interface RunAgentOptions {
  /** Host-owned execution service; embedders normally let the runtime create it. */
  toolExecution?: ToolExecutionService;
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
  session?: { manager: SessionManager; id: string; turnId?: string };
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
    threshold?: number; // default 0.8
    summarizerModel?: string;
    keepFirstPairs?: number;
    keepLastMessages?: number;
  };
  /** Inject system reminders before the user message (date, todos, etc).
   *  Pass `false` to disable; pass a partial list to limit which builders run. */
  systemReminders?: false | { enabled?: ReminderType[] };
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

/** Max sub-agent recursion: top-level (0) may spawn sub-agents (depth 1); those
 *  cannot spawn more. */
const MAX_SUBAGENT_DEPTH = 1;
/** Tools a sub-agent never gets (would let it mutate the parent's control flow). */
const SUBAGENT_TOOL_DENYLIST = new Set([
  'Task',
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
  // Background tasks are top-level only (a sub-agent has no task manager).
  'TaskCreate',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskUpdate',
  'TaskStop',
  'Monitor',
]);
/** Default turn cap for a sub-agent run when its frontmatter doesn't set one. */
const DEFAULT_SUBAGENT_MAX_TURNS = 12;

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
  stopReason:
    'end_turn' | 'stop_sequence' | 'max_tokens' | 'max_turns' | 'aborted' | 'error' | 'blocked';
  /** Mode-control signals flipped by tools during this run (M3c-rest). */
  modeSignal?: { exitPlanMode?: boolean; enterPlanMode?: boolean };
}

const DEFAULT_MAX_TURNS = 16;

/**
 * Tools with no side effects whose results don't depend on each other — safe to
 * execute concurrently within a single turn. Everything else (Edit/Write/Bash/
 * TodoWrite/AskUserQuestion/ExitPlanMode) runs sequentially to preserve snapshot
 * ordering, mutation order, and one-at-a-time interactive prompts.
 */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'SubmitReviewFinding',
]);

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
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  return opts.session
    ? opts.session.manager.withWriter(opts.session.id, () => runAgentOwned(opts))
    : runAgentOwned(opts);
}

async function runAgentOwned(opts: RunAgentOptions): Promise<RunAgentResult> {
  const shells = opts.shells ?? new ShellRegistry();
  const execution = opts.toolExecution ?? new ToolExecutionService(opts);
  try {
    return await execution.withScope(() =>
      runAgentInner({ ...opts, signal: execution.signal, shells, toolExecution: execution }),
    );
  } finally {
    try {
      if (!opts.toolExecution) await execution.close();
    } finally {
      if (!opts.shells) await shells.closeAll();
    }
  }
}

async function runAgentInner(opts: RunAgentOptions): Promise<RunAgentResult> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const runtimePolicy = resolveRuntimePolicy(opts);
  const allowedToolNames = opts.allowedTools ? new Set(opts.allowedTools) : undefined;
  let history: StoredMessage[] = [...(opts.history ?? [])];
  const execution = opts.toolExecution!;

  // Append the user message first (if provided). When systemReminders is
  // enabled (default), prepend a <system-reminder> block ahead of the user
  // text so the model sees pending todos / date / cwd / etc.
  if (opts.userMessage !== undefined) {
    let userText = opts.userMessage;
    if (opts.systemReminders !== false) {
      try {
        // Lazy-load with @vite-ignore so bundlers skip this module — the
        // renderer passes systemReminders:false to bypass it entirely, and
        // a static import here would drag node:fs into the browser bundle.
        const remindersMod = /* @vite-ignore */ './reminders/index.js';
        const { buildSystemReminders } = (await import(
          remindersMod
        )) as typeof import('./reminders/index.js');
        const block = await buildSystemReminders(
          {
            cwd: opts.cwd,
            sessionDir: opts.session
              ? `${opts.session.manager.resourceRoot}/${opts.session.id}`
              : undefined,
          },
          opts.systemReminders ?? {},
        );
        if (block) userText = `${block}\n\n${userText}`;
      } catch {
        /* reminder failures must not abort the agent */
      }
    }
    // UserPromptSubmit hook — fires before the prompt is processed; any JSON
    // `additionalContext` it returns is appended to the prompt. Top-level only
    // (a sub-agent's prompt isn't a user prompt).
    if (opts.hooks && (opts.subAgentDepth ?? 0) === 0) {
      try {
        const r = await opts.hooks.dispatch({
          signal: opts.signal,
          event: 'UserPromptSubmit',
          cwd: opts.cwd,
          triggeredAt: new Date().toISOString(),
          payload: { prompt: opts.userMessage },
        });
        const extra = r.json?.additionalContext;
        if (typeof extra === 'string' && extra.trim()) userText = `${userText}\n\n${extra}`;
      } catch {
        /* hook failure must not abort the prompt */
      }
    }
    const userMsg: StoredMessage = {
      role: 'user',
      content: [{ type: 'text', text: userText }],
      timestamp: new Date().toISOString(),
    };
    history.push(userMsg);
    if (opts.session) {
      await opts.session.manager.record(opts.session.id, [
        {
          type: opts.persistSessionMessages === false ? 'message.observed' : 'message.appended',
          turnId: opts.session.turnId,
          payload: { message: userMsg },
        },
      ]);
    }
  }

  // modeSignal is mutable — EnterPlanMode / ExitPlanMode flip these; the agent
  // loop owner reads them after the run to switch mode (default ⇄ plan).
  const modeSignal: { exitPlanMode?: boolean; enterPlanMode?: boolean } = {};

  const toolCtx: ToolContext = {
    cwd: opts.cwd,
    signal: opts.signal,
    sandboxConfig: opts.sandboxConfig,
    sandboxDefaultMode: opts.sandboxDefaultMode,
    contract: opts.contract,
    sessionDir: opts.session
      ? `${opts.session.manager.resourceRoot}/${opts.session.id}`
      : undefined,
    sessionsRoot: opts.session?.manager.resourceRoot,
    sessionId: opts.session?.id,
    sessionSearchScope: opts.sessionSearchScope,
    turnId: opts.session?.turnId,
    askUser: opts.askUser,
    modeSignal,
  };

  // Wire the Task tool's sub-agent runner — but only below the recursion cap,
  // so a sub-agent can't spawn further sub-agents (it also never gets the Task
  // tool, see the denylist below; this is belt-and-suspenders).
  const depth = opts.subAgentDepth ?? 0;
  if (depth < MAX_SUBAGENT_DEPTH) {
    toolCtx.runSubAgent = async ({ prompt, agentType, signal }) => {
      // Resolve a named sub-agent from disk (lazy import keeps node:fs out of
      // browser bundles; failures degrade to a generic sub-agent prompt).
      let systemPrompt =
        'You are a focused sub-agent. Complete the task below using the available tools, then reply with a concise summary of your findings or result. You have no memory of any other conversation.';
      let model = opts.model;
      let subMaxTurns = DEFAULT_SUBAGENT_MAX_TURNS;
      let allow: Set<string> | null = null;
      try {
        const mod = /* @vite-ignore */ './sub-agents/index.js';
        const { loadSubAgents, findSubAgent } = (await import(
          mod
        )) as typeof import('./sub-agents/index.js');
        const agents = await loadSubAgents({ cwd: opts.cwd, pluginDirs: opts.pluginDirs });
        const found = agentType ? findSubAgent(agents, agentType) : undefined;
        if (agentType && !found) {
          const names = agents.map((a) => a.qualifiedName).join(', ') || '(none)';
          throw new Error(`unknown subagent_type "${agentType}". Available: ${names}`);
        }
        if (found) {
          systemPrompt = found.body.trim() || systemPrompt;
          if (found.frontmatter.model) model = found.frontmatter.model;
          if (found.frontmatter.maxTurns) subMaxTurns = found.frontmatter.maxTurns;
          if (found.frontmatter.tools?.length) allow = new Set(found.frontmatter.tools);
        }
      } catch (err) {
        if (agentType) throw err; // explicit agent requested but not found/loadable
        // else: no agent named — proceed with the generic sub-agent prompt
      }

      // A registry view exposing only the sub-agent's allowed tools (its
      // frontmatter whitelist, if any) minus the control/recursion tools.
      // Built inline so agent.ts never imports ToolRegistry/BUILTIN_TOOLS
      // (which would drag node:fs into the renderer bundle).
      const subTools = {
        definitions: () =>
          opts.tools
            .definitions()
            .filter(
              (d) =>
                !SUBAGENT_TOOL_DENYLIST.has(d.name) &&
                (!allow || allow.has(d.name)) &&
                (!allowedToolNames || allowedToolNames.has(d.name)),
            ),
        get: (name: string) =>
          SUBAGENT_TOOL_DENYLIST.has(name) ||
          (allow && !allow.has(name)) ||
          (allowedToolNames && !allowedToolNames.has(name))
            ? undefined
            : opts.tools.get(name),
        list: () =>
          opts.tools
            .list()
            .filter(
              (t) =>
                !SUBAGENT_TOOL_DENYLIST.has(t.name) &&
                (!allow || allow.has(t.name)) &&
                (!allowedToolNames || allowedToolNames.has(t.name)),
            ),
      } as typeof opts.tools;

      const sub = await runAgent({
        provider: opts.provider,
        tools: subTools,
        systemPrompt,
        userMessage: prompt,
        model,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        maxTurns: subMaxTurns,
        cwd: opts.cwd,
        // A background task passes its own signal so TaskStop can cancel just
        // that task; foreground sub-agents inherit the main run's signal.
        signal: signal ?? opts.signal,
        mode: runtimePolicy.mode,
        permissions: runtimePolicy.permissions,
        // Every gate the parent runs under has to travel with the delegation.
        // A contract that stops at the Task boundary is one that says "never
        // read .env" to the main agent and nothing at all to the sub-agent it
        // spawns to do the reading.
        contract: opts.contract,
        hooks: opts.hooks,
        sandboxConfig: opts.sandboxConfig,
        sandboxDefaultMode: opts.sandboxDefaultMode,
        approval: opts.approval,
        unattended: opts.unattended,
        onApprovalRequired: opts.onApprovalRequired,
        ledger: opts.ledger,
        toolDeadlines: opts.toolDeadlines,
        spillStore: opts.spillStore,
        spillThresholdChars: opts.spillThresholdChars,
        autoMode: opts.autoMode,
        systemReminders: false, // sub-agent gets a clean context
        subAgentDepth: depth + 1,
      });
      const text = sub.history
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.content)
        .filter((b): b is import('./types.js').TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      // SubagentStop hook — fires when a sub-agent finishes.
      if (opts.hooks) {
        try {
          await opts.hooks.dispatch({
            signal: opts.signal,
            event: 'SubagentStop',
            cwd: opts.cwd,
            triggeredAt: new Date().toISOString(),
            payload: { agentType: agentType ?? 'general', turnsUsed: sub.turnsUsed },
          });
        } catch {
          /* hook failure must not break the sub-agent result */
        }
      }
      return { text, turnsUsed: sub.turnsUsed, agentType: agentType ?? 'general' };
    };
  }

  // Background tasks (TaskCreate family) — only at the top level, backed by the
  // sub-agent runner. Each task gets its own AbortController so TaskStop cancels
  // just that task. A sub-agent (depth ≥ 1) gets no manager → can't spawn tasks.
  if (depth === 0 && toolCtx.runSubAgent) {
    const runSub = toolCtx.runSubAgent;
    const runner: TaskRunner = (spec) => {
      const ac = new AbortController();
      const done = runSub({
        prompt: spec.prompt,
        agentType: spec.agentType,
        signal: ac.signal,
      }).then((r) => r.text);
      return { done, abort: () => ac.abort() };
    };
    // Reuse a host-provided manager (e.g. REPL session-scoped) so tasks persist
    // across turns and stay visible to slash commands; attach THIS run's runner
    // either way (it resolves named sub-agents + fires SubagentStop). Otherwise
    // fall back to a per-run manager (the original behavior).
    if (opts.taskManager) {
      opts.taskManager.setRunner(runner);
      toolCtx.tasks = opts.taskManager;
    } else {
      toolCtx.tasks = new TaskManager(runner);
    }
  }

  toolCtx.shells = opts.shells;
  execution.setRuntimeContext(toolCtx);

  const totalUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 };
  let turnsUsed = 0;

  // One chain per run. A run begins with a user message, which is exactly when
  // a fresh line of work starts, so there is nothing to carry over.
  const repeatGuard =
    opts.repeatGuard === false ? undefined : new RepeatToolGuard(opts.repeatGuard ?? {});

  // Stop hook — fires when the TOP-LEVEL agent finishes a run (a sub-agent's
  // completion is signalled by SubagentStop instead). Observation only.
  const fireStop = async (reason: string): Promise<void> => {
    if (!opts.hooks || depth !== 0) return;
    try {
      await opts.hooks.dispatch({
        signal: opts.signal,
        event: 'Stop',
        cwd: opts.cwd,
        triggeredAt: new Date().toISOString(),
        payload: { stopReason: reason, turnsUsed },
      });
    } catch {
      /* hook failure must not affect the result */
    }
  };

  const finish = async (stopReason: RunAgentResult['stopReason']): Promise<RunAgentResult> => {
    await fireStop(stopReason);
    if (opts.signal?.aborted) stopReason = 'aborted';
    const message = [...history].reverse().find((candidate) => candidate.role === 'assistant');
    opts.onEvent?.({ type: 'turn_complete', stopReason, message });
    return { history, turnsUsed, usage: totalUsage, stopReason, modeSignal };
  };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (opts.signal?.aborted) {
      return finish('aborted');
    }

    turnsUsed++;
    let result;
    try {
      result = await opts.provider.runTurn({
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        tools: opts.tools
          .definitions()
          .filter((definition) => !allowedToolNames || allowedToolNames.has(definition.name)),
        // Snapshot the history slice — providers must not see mutations from
        // subsequent turns (and tests rely on the snapshot being stable).
        messages: [...history],
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        signal: opts.signal,
        handlers: {
          onTextDelta: (text) => opts.onEvent?.({ type: 'text_delta', text }),
          onThinkingDelta: (text) => opts.onEvent?.({ type: 'thinking_delta', text }),
        },
      });
    } catch (err) {
      if (opts.signal?.aborted || (err as { name?: string }).name === 'AbortError') {
        return finish('aborted');
      }
      const message = (err as Error).message ?? 'unknown';
      opts.onEvent?.({ type: 'error', error: message });
      return finish('error');
    }

    if (opts.signal?.aborted) return finish('aborted');
    totalUsage.inputTokens += result.usage.inputTokens;
    totalUsage.outputTokens += result.usage.outputTokens;
    totalUsage.reasoningTokens += result.usage.reasoningTokens;
    totalUsage.cacheReadTokens += result.usage.cacheReadTokens;
    opts.onEvent?.({
      type: 'usage',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
    });

    const assistantMsg: StoredMessage = {
      role: 'assistant',
      content: result.content,
      timestamp: new Date().toISOString(),
    };
    history.push(assistantMsg);
    if (opts.session) {
      await opts.session.manager.record(opts.session.id, [
        {
          type: opts.persistSessionMessages === false ? 'message.observed' : 'message.appended',
          turnId: opts.session.turnId,
          payload: { message: assistantMsg },
        },
      ]);
    }

    opts.onEvent?.({ type: 'model_step_complete', step: turnsUsed, message: assistantMsg });

    // Emit any tool_use events
    for (const block of result.content) {
      if (block.type === 'tool_use') {
        opts.onEvent?.({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    // If no tool calls, we're done
    if (result.stopReason !== 'tool_use') {
      return finish(result.stopReason);
    }

    // Execute tool calls and append a single user-role message with tool_result
    // blocks. Two phases:
    //   1. (sequential) resolve handler + permission for each call. Approval
    //      prompts must never overlap, so gating stays strictly ordered.
    //   2. (mixed) execute. Side-effect-free reads run concurrently via
    //      Promise.all (the common "model emits 3 Reads at once" case); tools
    //      that mutate state / snapshot run sequentially to preserve ordering.
    // tool_result blocks carry their tool_use_id, so the final array is
    // re-assembled in the model's original order regardless of finish order.
    const toolBlocks = result.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    const resultsById = new Map<string, ToolResultBlock>();
    const guardReminders: string[] = [];
    const ready: PreparedToolCall[] = [];

    /**
     * Append this batch's tool results to history, in the model's original call
     * order, and persist them.
     *
     * Any `tool_use` still without a result gets a synthetic one. That happens
     * when the loop stops mid-batch (unattended abort): leaving a `tool_use`
     * unanswered produces a message sequence the provider rejects on resume,
     * so an explicit "never ran" beats a silent hole.
     */
    const flushToolResults = async (): Promise<void> => {
      const toolResults: ToolResultBlock[] = toolBlocks.map(
        (b) =>
          resultsById.get(b.id) ?? {
            type: 'tool_result',
            tool_use_id: b.id,
            content: 'Tool call not executed: the run stopped before reaching it.',
            is_error: true,
          },
      );
      const resultMsg: StoredMessage = {
        role: 'user',
        content: toolResults as ContentBlock[],
        timestamp: new Date().toISOString(),
      };
      history.push(resultMsg);
      if (opts.session) {
        await opts.session.manager.record(opts.session.id, [
          {
            type: opts.persistSessionMessages === false ? 'message.observed' : 'message.appended',
            turnId: opts.session.turnId,
            payload: { message: resultMsg },
          },
        ]);
      }
    };

    /**
     * Append any guard reminders as their own user message.
     *
     * This has to be a separate message appended AFTER the tool results, not a
     * text block alongside them: the provider maps a user message's text and
     * its tool_result blocks to separate wire messages, and a `user` turn
     * between the assistant's tool_calls and their `tool` replies is a sequence
     * the API rejects.
     */
    const flushGuardReminders = async (): Promise<void> => {
      if (guardReminders.length === 0) return;
      const msg: StoredMessage = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `<system-reminder>\n${guardReminders.join('\n\n')}\n</system-reminder>`,
          },
        ],
        timestamp: new Date().toISOString(),
      };
      history.push(msg);
      if (opts.session) {
        await opts.session.manager.record(opts.session.id, [
          {
            type: opts.persistSessionMessages === false ? 'message.observed' : 'message.appended',
            turnId: opts.session.turnId,
            payload: { message: msg },
          },
        ]);
      }
    };

    const record = (call: PreparedToolCall, result: import('./types.js').ToolResult): void => {
      resultsById.set(call.id, {
        type: 'tool_result',
        tool_use_id: call.id,
        content: result.content,
        is_error: result.isError,
      });
    };
    try {
      for (const toolUse of toolBlocks) {
        const repeat = repeatGuard?.observe(toolUse.name, toolUse.input);
        if (repeat) guardReminders.push(repeat.text);
        const call = await execution.prepare(toolUse.name, toolUse.input, toolUse.id, false);
        if (call.result) record(call, call.result);
        else ready.push(call);
        if (execution.blocked) {
          await flushToolResults();
          return finish('blocked');
        }
      }
      const execute = async (call: PreparedToolCall) => record(call, await execution.execute(call));
      await Promise.all(ready.filter((call) => READ_ONLY_TOOLS.has(call.name)).map(execute));
      for (const call of ready.filter((call) => !READ_ONLY_TOOLS.has(call.name)))
        await execute(call);
    } catch (error) {
      if (opts.signal?.aborted && !(error as Error).message?.includes('cleanup_incomplete'))
        return finish('aborted');
      opts.onEvent?.({ type: 'error', error: (error as Error).message });
      return finish('error');
    }

    await flushToolResults();
    await flushGuardReminders();

    // M3c: auto-compact if the *current* context crossed the threshold.
    //
    // Use this turn's usage (result.usage), NOT the cumulative totalUsage.
    // `result.usage.inputTokens` is exactly the size of the history we just
    // sent to the model, so it is the true current-context proxy. Cumulative
    // usage is wrong on two counts: it sums every turn's input (each turn
    // re-sends the whole history, so it inflates far past the real window and
    // crosses the threshold too early), and it never shrinks after a compaction
    // — meaning once over the line it would re-compact the already-compacted
    // history on every subsequent turn. The next turn's inputTokens naturally
    // reflects the freshly-compacted (smaller) context, so this self-corrects.
    if (
      opts.autoCompact &&
      shouldCompact({
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        contextWindow: opts.autoCompact.contextWindow,
        threshold: opts.autoCompact.threshold,
      })
    ) {
      try {
        if (opts.hooks) {
          await opts.hooks.dispatch({
            signal: opts.signal,
            event: 'PreCompact',
            cwd: opts.cwd,
            triggeredAt: new Date().toISOString(),
            payload: { messages: history.length, trigger: 'auto' },
          });
        }
        const compactResult = await compact(history, {
          provider: opts.provider,
          summarizerModel: opts.autoCompact.summarizerModel ?? opts.model,
          signal: opts.signal,
          keepFirstPairs: opts.autoCompact.keepFirstPairs,
          keepLastMessages: opts.autoCompact.keepLastMessages,
        });
        if (opts.signal?.aborted) return finish('aborted');
        history = compactResult.history;
        totalUsage.inputTokens += compactResult.usage.inputTokens;
        totalUsage.outputTokens += compactResult.usage.outputTokens;
        opts.onEvent?.({
          type: 'usage',
          inputTokens: compactResult.usage.inputTokens,
          outputTokens: compactResult.usage.outputTokens,
          reasoningTokens: 0,
          cacheReadTokens: 0,
        });
        if (opts.hooks) {
          await opts.hooks.dispatch({
            signal: opts.signal,
            event: 'PostCompact',
            cwd: opts.cwd,
            triggeredAt: new Date().toISOString(),
            payload: { messages: history.length, trigger: 'auto' },
          });
        }
      } catch {
        // compaction failure is non-fatal — continue with full history
      }
    }
  }

  return finish('max_turns');
}

export const AGENT_MODULE_VERSION = '0.1.0';
