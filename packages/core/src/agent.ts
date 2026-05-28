// Agent loop — orchestrates provider <-> tools <-> session.
// Spec: docs/DEVELOPMENT_PLAN.md §3.1 / §3.15

import { compact, shouldCompact } from './compaction/index.js';
import type { PermissionRules } from './config/types.js';
import { dispatchToolCall, type DispatchVerdict } from './harness/tool-dispatcher.js';
import type { HookDispatcher } from './hooks/index.js';
import type { Mode } from './types.js';
import type { Provider } from './providers/types.js';
import { SessionManager } from './sessions/index.js';
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
 * Approval callback — return true to allow, false to reject.
 * Called when dispatcher returns 'ask'.
 */
export type ApprovalCallback = (
  toolName: string,
  toolInput: Record<string, unknown>,
  verdict: DispatchVerdict,
) => Promise<boolean> | boolean;

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
}

const DEFAULT_MAX_TURNS = 16;

/**
 * Runs the agent loop until the model produces an end_turn (no tool calls),
 * or `maxTurns` is reached, or the abort signal fires.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  let history: StoredMessage[] = [...(opts.history ?? [])];
  let snapshotSeq = (await opts.session?.manager.snapshots(opts.session.id))?.length ?? 0;

  // Append the user message first (if provided)
  if (opts.userMessage !== undefined) {
    const userMsg: StoredMessage = {
      role: 'user',
      content: [{ type: 'text', text: opts.userMessage }],
      timestamp: new Date().toISOString(),
    };
    history.push(userMsg);
    if (opts.session) await opts.session.manager.append(opts.session.id, userMsg);
  }

  const toolCtx: ToolContext = {
    cwd: opts.cwd,
    signal: opts.signal,
    sandboxConfig: opts.sandboxConfig,
    sessionDir: opts.session
      ? `${opts.session.manager.root}/${opts.session.id}`
      : undefined,
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
      return { history, turnsUsed, usage: totalUsage, stopReason: 'error' };
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
      return { history, turnsUsed, usage: totalUsage, stopReason: 'end_turn' };
    }

    // Execute tool calls and append a single user-role message with tool_result blocks
    const toolResults: ToolResultBlock[] = [];
    for (const block of result.content) {
      if (block.type !== 'tool_use') continue;
      const toolUse = block as ToolUseBlock;
      const handler = opts.tools.get(toolUse.name);
      if (!handler) {
        toolResults.push({
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
        });
        let allowed = verdict.decision === 'allow';
        if (verdict.decision === 'ask' && opts.approval) {
          allowed = await opts.approval(toolUse.name, toolUse.input, verdict);
        }
        if (!allowed) {
          toolResults.push({
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

      // Pre-execution snapshot (Edit/Write only)
      if (
        opts.enableSnapshots !== false &&
        opts.session &&
        (toolUse.name === 'Edit' || toolUse.name === 'Write')
      ) {
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

      // Post-execution snapshot
      if (
        opts.enableSnapshots !== false &&
        opts.session &&
        (toolUse.name === 'Edit' || toolUse.name === 'Write') &&
        !tr.isError
      ) {
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
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: tr.content,
        is_error: tr.isError,
      });
    }

    const resultMsg: StoredMessage = {
      role: 'user',
      content: toolResults as ContentBlock[],
      timestamp: new Date().toISOString(),
    };
    history.push(resultMsg);
    if (opts.session) await opts.session.manager.append(opts.session.id, resultMsg);

    // M3c: auto-compact if usage crossed threshold
    if (
      opts.autoCompact &&
      shouldCompact({
        inputTokens: totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens,
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

  return { history, turnsUsed, usage: totalUsage, stopReason: 'max_turns' };
}

export const AGENT_MODULE_VERSION = '0.1.0';
