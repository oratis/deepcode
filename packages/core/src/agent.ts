// Agent loop — orchestrates provider <-> tools <-> session.
// Spec: docs/DEVELOPMENT_PLAN.md §3.1 / §3.15

import { compact, shouldCompact } from './compaction/index.js';
import type { PermissionRules } from './config/types.js';
import { dispatchToolCall, type DispatchVerdict } from './harness/tool-dispatcher.js';
import { TaskManager } from './tasks/manager.js';
import type { HookDispatcher } from './hooks/index.js';
import type { Mode } from './types.js';
import type { Provider } from './providers/types.js';
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
  session?: { manager: SessionManager; id: string };
  /** Optional: snapshot files before/after Edit/Write tool calls. */
  enableSnapshots?: boolean;
  /** M3: dispatch gates (mode + permissions + hooks). When set, every tool call
   *  goes through the gate. When unset, all tool calls are allowed (M1 behavior). */
  mode?: Mode;
  permissions?: PermissionRules;
  hooks?: HookDispatcher;
  approval?: ApprovalCallback;
  /** AutoModeConfig from settings.autoMode — used when mode === 'auto'. */
  autoMode?: import('./config/types.js').AutoModeConfig;
  /** M3.5: passed through to Bash tool ctx for sandbox wrapping. */
  sandboxConfig?: import('./config/types.js').SandboxConfig;
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
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  /** Reason the loop terminated. */
  stopReason: 'end_turn' | 'max_turns' | 'aborted' | 'error';
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
const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);

/**
 * Runs the agent loop until the model produces an end_turn (no tool calls),
 * or `maxTurns` is reached, or the abort signal fires.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  let history: StoredMessage[] = [...(opts.history ?? [])];
  let snapshotSeq = (await opts.session?.manager.snapshots(opts.session.id))?.length ?? 0;

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
              ? `${opts.session.manager.root}/${opts.session.id}`
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
    if (opts.session) await opts.session.manager.append(opts.session.id, userMsg);
  }

  // modeSignal is mutable — EnterPlanMode / ExitPlanMode flip these; the agent
  // loop owner reads them after the run to switch mode (default ⇄ plan).
  const modeSignal: { exitPlanMode?: boolean; enterPlanMode?: boolean } = {};
  const toolCtx: ToolContext = {
    cwd: opts.cwd,
    signal: opts.signal,
    sandboxConfig: opts.sandboxConfig,
    sessionDir: opts.session ? `${opts.session.manager.root}/${opts.session.id}` : undefined,
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
            .filter((d) => !SUBAGENT_TOOL_DENYLIST.has(d.name) && (!allow || allow.has(d.name))),
        get: (name: string) =>
          SUBAGENT_TOOL_DENYLIST.has(name) || (allow && !allow.has(name))
            ? undefined
            : opts.tools.get(name),
        list: () =>
          opts.tools
            .list()
            .filter((t) => !SUBAGENT_TOOL_DENYLIST.has(t.name) && (!allow || allow.has(t.name))),
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
        mode: opts.mode,
        permissions: opts.permissions,
        hooks: opts.hooks,
        sandboxConfig: opts.sandboxConfig,
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

  // Wire the mcp_tool + agent hook dispatchers. These can only be supplied here
  // (not at the host's HookDispatcher construction): mcp_tool needs the live
  // tool registry where MCP tools are registered as `mcp__<server>__<tool>`, and
  // `agent` needs the sub-agent runner built just above. setX() no-ops if the
  // host already provided one, so this never clobbers explicit wiring.
  if (opts.hooks) {
    opts.hooks.setMcpToolDispatcher(async (handler) => {
      const qualified = `mcp__${handler.server}__${handler.tool}`;
      const tool = opts.tools.get(qualified);
      if (!tool) {
        return { stdout: '', stderr: `mcp_tool hook: ${qualified} is not registered`, exitCode: 1 };
      }
      try {
        const r = await tool.execute((handler.arguments ?? {}) as Record<string, unknown>, toolCtx);
        return {
          stdout: r.content,
          stderr: r.isError ? r.content : '',
          exitCode: r.isError ? 1 : 0,
        };
      } catch (err) {
        return { stdout: '', stderr: (err as Error).message, exitCode: 1 };
      }
    });

    // The agent hook runs a named sub-agent. Only wire it when a sub-agent
    // runner exists (i.e. below the recursion cap). A re-entrancy guard stops a
    // hook that fires *during* the sub-agent run from spawning more agents — the
    // dispatcher is shared with the sub-agent loop, so the same flag is seen.
    if (toolCtx.runSubAgent) {
      const runSub = toolCtx.runSubAgent;
      let agentHookRunning = false;
      opts.hooks.setAgentDispatcher(async (handler, payload) => {
        if (agentHookRunning) {
          return { stdout: '', stderr: 'agent hook skipped (re-entrancy guard)', exitCode: 0 };
        }
        const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const prompt = handler.prompt
          ? `${handler.prompt}\n\nHook event payload:\n${payloadStr}`
          : payloadStr;
        agentHookRunning = true;
        try {
          const res = await runSub({ prompt, agentType: handler.agent });
          return { stdout: res.text, stderr: '', exitCode: 0 };
        } catch (err) {
          return { stdout: '', stderr: (err as Error).message, exitCode: 1 };
        } finally {
          agentHookRunning = false;
        }
      });
    }
  }

  // Background tasks (TaskCreate family) — only at the top level, backed by the
  // sub-agent runner. Each task gets its own AbortController so TaskStop cancels
  // just that task. A sub-agent (depth ≥ 1) gets no manager → can't spawn tasks.
  if (depth === 0 && toolCtx.runSubAgent) {
    const runSub = toolCtx.runSubAgent;
    toolCtx.tasks = new TaskManager((spec) => {
      const ac = new AbortController();
      const done = runSub({
        prompt: spec.prompt,
        agentType: spec.agentType,
        signal: ac.signal,
      }).then((r) => r.text);
      return { done, abort: () => ac.abort() };
    });
  }

  const totalUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  let turnsUsed = 0;

  // Stop hook — fires when the TOP-LEVEL agent finishes a run (a sub-agent's
  // completion is signalled by SubagentStop instead). Observation only.
  const fireStop = async (reason: string): Promise<void> => {
    if (!opts.hooks || depth !== 0) return;
    try {
      await opts.hooks.dispatch({
        event: 'Stop',
        cwd: opts.cwd,
        triggeredAt: new Date().toISOString(),
        payload: { stopReason: reason, turnsUsed },
      });
    } catch {
      /* hook failure must not affect the result */
    }
  };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (opts.signal?.aborted) {
      return {
        history,
        turnsUsed,
        usage: totalUsage,
        stopReason: 'aborted',
        modeSignal,
      };
    }

    turnsUsed++;
    let result;
    try {
      result = await opts.provider.runTurn({
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        tools: opts.tools.definitions(),
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
      const message = (err as Error).message ?? 'unknown';
      opts.onEvent?.({ type: 'error', error: message });
      return { history, turnsUsed, usage: totalUsage, stopReason: 'error', modeSignal };
    }

    totalUsage.inputTokens += result.usage.inputTokens;
    totalUsage.outputTokens += result.usage.outputTokens;
    totalUsage.reasoningTokens += result.usage.reasoningTokens;
    opts.onEvent?.({
      type: 'usage',
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningTokens,
    });

    const assistantMsg: StoredMessage = {
      role: 'assistant',
      content: result.content,
      timestamp: new Date().toISOString(),
    };
    history.push(assistantMsg);
    if (opts.session) await opts.session.manager.append(opts.session.id, assistantMsg);

    opts.onEvent?.({ type: 'turn_complete', message: assistantMsg });

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
      await fireStop('end_turn');
      return { history, turnsUsed, usage: totalUsage, stopReason: 'end_turn', modeSignal };
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
    type Ready = { toolUse: ToolUseBlock; handler: NonNullable<ReturnType<typeof opts.tools.get>> };
    const ready: Ready[] = [];

    // Phase 1 — sequential gate + approval.
    for (const toolUse of toolBlocks) {
      const handler = opts.tools.get(toolUse.name);
      if (!handler) {
        resultsById.set(toolUse.id, {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Error: tool not found: ${toolUse.name}`,
          is_error: true,
        });
        continue;
      }

      // M3: dispatch gate (mode + permissions + PreToolUse hook)
      if (opts.mode) {
        const verdict = await dispatchToolCall({
          tool: toolUse.name,
          input: toolUse.input,
          mode: opts.mode,
          rules: opts.permissions,
          hooks: opts.hooks,
          cwd: opts.cwd,
          autoMode: opts.autoMode,
          autoModeProvider: opts.provider,
        });
        let allowed = verdict.decision === 'allow';
        if (verdict.decision === 'ask' && opts.approval) {
          const decision = await opts.approval(toolUse.name, toolUse.input, verdict);
          // 'always' = host has (or will) persist a matcher; treat as allow-this-call.
          allowed = decision === true || decision === 'always';
        }
        if (!allowed) {
          resultsById.set(toolUse.id, {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Tool call blocked: ${verdict.reason}`,
            is_error: true,
          });
          opts.onEvent?.({
            type: 'tool_result',
            id: toolUse.id,
            result: {
              content: verdict.reason,
              isError: true,
              data: { dispatchSource: verdict.source, decision: verdict.decision },
            },
          });
          continue;
        }
      }

      ready.push({ toolUse, handler });
    }

    // Runs one approved tool end-to-end: pre-snapshot, execute, PostToolUse
    // hook, post-snapshot, event + result. Side-effect-free tools call this
    // concurrently; mutating tools call it one at a time (see partition below).
    const execOne = async ({ toolUse, handler }: Ready): Promise<void> => {
      const isFileMutation = toolUse.name === 'Edit' || toolUse.name === 'Write';

      if (opts.enableSnapshots !== false && opts.session && isFileMutation) {
        const filePath = (toolUse.input as { file_path?: string }).file_path;
        if (filePath) {
          await opts.session.manager.snapshot({
            sessionId: opts.session.id,
            cwd: opts.cwd,
            filePath,
            reason: `pre-${toolUse.name}`,
            seq: ++snapshotSeq,
          });
        }
      }

      // Bash can mutate arbitrary files we can't name ahead of time, so capture
      // a git working-tree checkpoint instead (no-op outside a git repo). This
      // lets `/rewind <seq> code` revert what the command changed.
      if (opts.enableSnapshots !== false && opts.session && toolUse.name === 'Bash') {
        await opts.session.manager.gitCheckpoint({
          sessionId: opts.session.id,
          cwd: opts.cwd,
          reason: 'pre-Bash',
          seq: ++snapshotSeq,
        });
      }

      let tr;
      try {
        tr = await handler.execute(toolUse.input, toolCtx);
      } catch (err) {
        tr = { content: `Error: ${(err as Error).message}`, isError: true };
      }

      // PostToolUse hook (M3) — observation only; can inject additionalContext
      if (opts.hooks) {
        await opts.hooks.dispatch({
          event: 'PostToolUse',
          cwd: opts.cwd,
          triggeredAt: new Date().toISOString(),
          payload: {
            tool: toolUse.name,
            input: toolUse.input,
            result_content: tr.content.slice(0, 1000),
            is_error: tr.isError ?? false,
          },
        });
      }

      if (opts.enableSnapshots !== false && opts.session && isFileMutation && !tr.isError) {
        const filePath = (toolUse.input as { file_path?: string }).file_path;
        if (filePath) {
          await opts.session.manager.snapshot({
            sessionId: opts.session.id,
            cwd: opts.cwd,
            filePath,
            reason: `post-${toolUse.name}`,
            seq: ++snapshotSeq,
          });
        }
      }

      opts.onEvent?.({ type: 'tool_result', id: toolUse.id, result: tr });
      resultsById.set(toolUse.id, {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: tr.content,
        is_error: tr.isError,
      });
    };

    // Phase 2 — execute. Read-only tools have no side effects and don't touch
    // snapshotSeq, so they're safe to run concurrently; everything else stays
    // sequential to keep snapshot ordering deterministic.
    const parallel = ready.filter((r) => READ_ONLY_TOOLS.has(r.toolUse.name));
    const serial = ready.filter((r) => !READ_ONLY_TOOLS.has(r.toolUse.name));
    await Promise.all(parallel.map(execOne));
    for (const r of serial) await execOne(r);

    // Re-assemble in the model's original tool-call order.
    const toolResults: ToolResultBlock[] = toolBlocks
      .map((b) => resultsById.get(b.id))
      .filter((r): r is ToolResultBlock => r !== undefined);

    const resultMsg: StoredMessage = {
      role: 'user',
      content: toolResults as ContentBlock[],
      timestamp: new Date().toISOString(),
    };
    history.push(resultMsg);
    if (opts.session) await opts.session.manager.append(opts.session.id, resultMsg);

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
            event: 'PreCompact',
            cwd: opts.cwd,
            triggeredAt: new Date().toISOString(),
            payload: { messages: history.length, trigger: 'auto' },
          });
        }
        const compactResult = await compact(history, {
          provider: opts.provider,
          summarizerModel: opts.autoCompact.summarizerModel,
          keepFirstPairs: opts.autoCompact.keepFirstPairs,
          keepLastMessages: opts.autoCompact.keepLastMessages,
        });
        history = compactResult.history;
        totalUsage.inputTokens += compactResult.usage.inputTokens;
        totalUsage.outputTokens += compactResult.usage.outputTokens;
        opts.onEvent?.({
          type: 'usage',
          inputTokens: compactResult.usage.inputTokens,
          outputTokens: compactResult.usage.outputTokens,
          reasoningTokens: 0,
        });
        if (opts.hooks) {
          await opts.hooks.dispatch({
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

  await fireStop('max_turns');
  return { history, turnsUsed, usage: totalUsage, stopReason: 'max_turns', modeSignal };
}

export const AGENT_MODULE_VERSION = '0.1.0';
