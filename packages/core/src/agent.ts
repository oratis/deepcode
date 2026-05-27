// Agent loop — orchestrates provider <-> tools <-> session.
// Spec: docs/DEVELOPMENT_PLAN.md §3.1 / §3.15

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
  const history: StoredMessage[] = [...(opts.history ?? [])];
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

  const toolCtx: ToolContext = { cwd: opts.cwd, signal: opts.signal };
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
  }

  return { history, turnsUsed, usage: totalUsage, stopReason: 'max_turns' };
}

export const AGENT_MODULE_VERSION = '0.1.0';
