import { modelInfo, type ProviderId } from './catalog.js';
// DeepSeek provider — OpenAI-compatible API at https://api.deepseek.com/v1
// Spec: docs/DEVELOPMENT_PLAN.md §3.1
// Effort numbers: docs/design/effort-levels.md §3.2

import OpenAI from 'openai';
import type { ContentBlock, StoredMessage, ToolUseBlock } from '../types.js';
import type { Provider, ProviderResult, ProviderRunOpts } from './types.js';
export { DEEPSEEK_MODELS, DEFAULT_CONTEXT_WINDOW, contextWindowFor } from './model-metadata.js';

export interface DeepSeekProviderOpts {
  apiKey: string;
  provider?: ProviderId;
  maxOutput?: number;
  baseURL?: string;
  /** Bearer token alternative — see §3.4 dual-header design. */
  authToken?: string;
  /** Injected fetch (used in tests). */
  fetch?: typeof globalThis.fetch;
}

// Backward-compatible name; all clients use the shared capability catalog.
export { DEEPSEEK_EFFORT_PARAMS as EFFORT_PARAMS } from './catalog.js';

export class DeepSeekProvider implements Provider {
  readonly name: ProviderId;
  private readonly maxOutput?: number;
  private readonly client: OpenAI;
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(opts: DeepSeekProviderOpts) {
    this.name = opts.provider ?? 'deepseek';
    this.maxOutput = opts.maxOutput;
    if (!opts.apiKey && !opts.authToken) {
      throw new Error('DeepSeekProvider requires apiKey or authToken');
    }
    // Use whichever credential is truthy (treat '' as absent so empty apiKey falls back to authToken).
    this.apiKey = opts.apiKey || opts.authToken || '';
    this.baseURL = opts.baseURL ?? 'https://api.deepseek.com/v1';
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      fetch: opts.fetch,
      // If authToken is set, the OpenAI SDK uses Bearer (correct for our dual-header design).
    });
  }

  /** Lightweight liveness check — does NOT hit the API, just confirms construction. */
  async ping(): Promise<{ ok: boolean }> {
    return { ok: this.apiKey.length > 0 && this.baseURL.startsWith('http') };
  }

  async runTurn(opts: ProviderRunOpts): Promise<ProviderResult> {
    const messages = anthropicShapeToOpenAI(
      opts.systemPrompt,
      opts.messages,
      this.name,
      opts.model,
    );
    const tools = opts.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const stream = await this.client.chat.completions.create(
      {
        model: opts.model,
        // OpenAI's strict generated types don't model DeepSeek-extended shapes — cast at the boundary.
        messages: messages as unknown as Parameters<
          typeof this.client.chat.completions.create
        >[0]['messages'],
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: Math.min(
          opts.maxTokens ?? 8_192,
          this.maxOutput ?? modelInfo(opts.model)?.maxOutput ?? 8_192,
        ),
        ...(this.name === 'deepseek' ? { temperature: opts.temperature ?? 0.4 } : {}),
        ...(this.name === 'kimi' || this.name === 'glm'
          ? {
              thinking: {
                type: 'enabled',
                ...(this.name === 'glm' ? { clear_thinking: false } : {}),
              },
            }
          : {}),
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: opts.signal },
    );

    let text = '';
    let thinking = '';
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    let finish: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let cacheReadTokens = 0;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta as
        { content?: string; reasoning_content?: string; tool_calls?: unknown[] } | undefined;

      if (delta?.content) {
        text += delta.content;
        opts.handlers?.onTextDelta?.(delta.content);
      }
      if (delta?.reasoning_content) {
        thinking += delta.reasoning_content;
        opts.handlers?.onThinkingDelta?.(delta.reasoning_content);
      }
      if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls as Array<{
          index: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>) {
          const idx = tc.index;
          if (!toolCalls.has(idx)) {
            toolCalls.set(idx, { id: '', name: '', args: '' });
          }
          const entry = toolCalls.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
        }
      }
      if (choice?.finish_reason) {
        finish = choice.finish_reason;
      }
      const usage = chunk.usage as
        | {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_cache_hit_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
            completion_tokens_details?: { reasoning_tokens?: number };
          }
        | undefined;
      if (usage) {
        inputTokens = usage.prompt_tokens ?? inputTokens;
        outputTokens = usage.completion_tokens ?? outputTokens;
        cacheReadTokens =
          usage.prompt_cache_hit_tokens ??
          usage.prompt_tokens_details?.cached_tokens ??
          cacheReadTokens;
        reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens;
      }
    }

    // Assemble content blocks
    const content: ContentBlock[] = [];
    if (thinking) {
      content.push({ type: 'thinking', text: thinking, provider: this.name, model: opts.model });
    }
    if (text) {
      content.push({ type: 'text', text });
    }
    // Assemble tool calls, dropping any that were truncated mid-stream. When the
    // completion hits max_tokens while emitting a tool call, the accumulated
    // `args` is partial JSON that won't parse — executing it produces garbage
    // (e.g. a Write with no file_path). A call with no name at all is a stray
    // streaming artifact. Both are dropped; a genuinely empty-arg call (args ===
    // '' or '{}', e.g. ExitPlanMode) is kept and validated by the tool itself.
    let validToolCalls = 0;
    let truncatedToolCall = false;
    for (const call of toolCalls.values()) {
      if (!finish || !call.id) {
        truncatedToolCall = true;
        continue;
      }
      if (!call.name) {
        truncatedToolCall = true;
        continue;
      }
      const parsed = safeParseJson(call.args);
      if (call.args !== '' && parsed === null) {
        truncatedToolCall = true;
        continue;
      }
      content.push({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: parsed ?? {},
      } satisfies ToolUseBlock);
      validToolCalls++;
    }

    // stopReason precedence: only claim 'tool_use' when at least one call
    // survived. If everything was truncated (or finish_reason was 'length'),
    // report 'max_tokens' so the agent loop ends cleanly instead of executing a
    // malformed call or looping on an empty tool turn.
    let stopReason: ProviderResult['stopReason'];
    if (!finish) stopReason = 'error';
    else if (finish === 'length' || truncatedToolCall) stopReason = 'max_tokens';
    else if (validToolCalls > 0 && finish === 'tool_calls') stopReason = 'tool_use';
    else if (finish !== 'stop') stopReason = 'error';
    else stopReason = 'end_turn';

    return {
      content:
        stopReason === 'tool_use' ? content : content.filter((block) => block.type !== 'tool_use'),
      stopReason,
      usage: { inputTokens, outputTokens, reasoningTokens, cacheReadTokens },
    };
  }
}

function safeParseJson(s: string): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const value: unknown = JSON.parse(s);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Convert DeepCode-internal messages to OpenAI chat-completions shape.
 * Tool calls / tool results get unfolded into separate `assistant` and `tool` messages.
 */
function anthropicShapeToOpenAI(
  systemPrompt: string,
  messages: StoredMessage[],
  provider: ProviderId = 'deepseek',
  model?: string,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (systemPrompt) {
    out.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      // user messages: text blocks become a single text content;
      // tool_result blocks become role:"tool" follow-ups.
      const textParts: string[] = [];
      const toolResults: Array<{ id: string; content: string }> = [];
      for (const block of msg.content) {
        if (block.type === 'text') textParts.push(block.text);
        else if (block.type === 'tool_result')
          toolResults.push({ id: block.tool_use_id, content: block.content });
      }
      if (textParts.length > 0) {
        out.push({ role: 'user', content: textParts.join('\n') });
      }
      for (const tr of toolResults) {
        out.push({ role: 'tool', tool_call_id: tr.id, content: tr.content });
      }
    } else {
      // assistant: combine text + tool_use into a single assistant message
      const textParts: string[] = [];
      const toolCalls: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }> = [];
      for (const block of msg.content) {
        if (block.type === 'text') textParts.push(block.text);
        else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          });
        }
        // Provider-scoped continuation is handled below; foreign thinking is never replayed.
      }
      const assistantMsg: Record<string, unknown> = { role: 'assistant' };
      if (provider !== 'deepseek') {
        const reasoning = msg.content
          .filter((b) => b.type === 'thinking' && b.provider === provider && b.model === model)
          .map((b) => (b.type === 'thinking' ? b.text : ''))
          .join('');
        if (reasoning) assistantMsg.reasoning_content = reasoning;
      }
      if (textParts.length > 0) assistantMsg.content = textParts.join('\n');
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      out.push(assistantMsg);
    }
  }

  return out;
}

// Exported for tests
export const __internals = { anthropicShapeToOpenAI, safeParseJson };
