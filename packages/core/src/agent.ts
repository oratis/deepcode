// Agent loop — orchestrates provider <-> tools <-> session.
// Spec: docs/DEVELOPMENT_PLAN.md §3.1 / §3.15

import { compact, shouldCompact } from './compaction/index.js';
import type { PermissionRules } from './config/types.js';
import { dispatchToolCall, type DispatchVerdict } from './harness/tool-dispatcher.js';
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
}

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
  modeSignal?: { exitPlanMode?: boolean };
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
        const { buildSystemReminders } = (await import(remindersMod)) as typeof import('./reminders/index.js');
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
    const userMsg: StoredMessage = {
      role: 'user',
      content: [{ type: 'text', text: userText }],
      timestamp: new Date().toISOString(),
    };
    history.push(userMsg);
    if (opts.session) await opts.session.manager.append(opts.session.id, userMsg);
  }

  // modeSignal is mutable — ExitPlanMode flips exitPlanMode = true; the agent
  // loop owner reads this between turns to switch mode plan → default.
  const modeSignal: { exitPlanMode?: boolean } = {};
  const toolCtx: ToolContext = {
    cwd: opts.cwd,
    signal: opts.signal,
    sandboxConfig: opts.sandboxConfig,
    sessionDir: opts.session
      ? `${opts.session.manager.root}/${opts.session.id}`
      : undefined,
    askUser: opts.askUser,
    modeSignal,
  };
  const totalUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  let turnsUsed = 0;

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
    const toolBlocks = result.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    );
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
      } catch {
        // compaction failure is non-fatal — continue with full history
      }
    }
  }

  return { history, turnsUsed, usage: totalUsage, stopReason: 'max_turns', modeSignal };
}

export const AGENT_MODULE_VERSION = '0.1.0';
