// DeepSeek provider — OpenAI-compatible API at https://api.deepseek.com/v1
// Spec: docs/DEVELOPMENT_PLAN.md §3.1
// Effort numbers: docs/design/effort-levels.md §3.2

import OpenAI from 'openai';
import type { ContentBlock, DeepSeekModel, Effort, StoredMessage, ToolUseBlock } from '../types.js';
import type { Provider, ProviderResult, ProviderRunOpts } from './types.js';

export interface DeepSeekProviderOpts {
  apiKey: string;
  baseURL?: string;
  /** Bearer token alternative — see §3.4 dual-header design. */
  authToken?: string;
  /** Injected fetch (used in tests). */
  fetch?: typeof globalThis.fetch;
}

// Validated against real DeepSeek API 2026-05-28: max_tokens hard limit is 8192,
// context window 128k. The two "logical" model names are stable API aliases that
// currently route to the V4 family.
export const DEEPSEEK_MODELS: Record<DeepSeekModel, { ctx: number; maxOutput: number }> = {
  'deepseek-chat': { ctx: 128_000, maxOutput: 8_192 },
  'deepseek-reasoner': { ctx: 128_000, maxOutput: 8_192 },
  'deepseek-v4-flash': { ctx: 128_000, maxOutput: 8_192 },
  'deepseek-v4-pro': { ctx: 128_000, maxOutput: 8_192 },
};

/** Fallback context window for an unrecognized model id. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Context-window size (tokens) for a model id. Single source of truth for the
 * context-bar + auto-compact threshold across CLI and desktop — avoids the
 * 128_000 literal drifting out of sync with DEEPSEEK_MODELS. Falls back to
 * DEFAULT_CONTEXT_WINDOW for unknown (e.g. user-typed) model ids.
 */
export function contextWindowFor(model: string): number {
  return DEEPSEEK_MODELS[model as DeepSeekModel]?.ctx ?? DEFAULT_CONTEXT_WINDOW;
}

/**
 * Effort → DeepSeek API parameters.
 * Numbers from docs/design/effort-levels.md §3.2.
 * NOTE: These are M1-design values; M1 implementation includes a benchmark
 * (`scripts/effort-bench.ts`) to verify and backfill measured numbers.
 */
export const EFFORT_PARAMS: Record<Effort, { maxTokens: number; temperature: number }> = {
  low: { maxTokens: 1_500, temperature: 0.2 },
  medium: { maxTokens: 3_000, temperature: 0.4 },
  high: { maxTokens: 6_000, temperature: 0.6 },
  xhigh: { maxTokens: 8_000, temperature: 0.7 },
  max: { maxTokens: 8_192, temperature: 0.8 },
};

export class DeepSeekProvider implements Provider {
  readonly name = 'deepseek';
  private readonly client: OpenAI;
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(opts: DeepSeekProviderOpts) {
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
      //
      // The OpenAI SDK refuses to start in a "browser-like" environment by default to
      // avoid users shipping API keys in pages served to untrusted clients. DeepCode is
      // never that case: it's a CLI / VS Code extension / Tauri desktop app, all of which
      // run on the user's own machine with the key in storage they control. In Node this
      // flag is a no-op (the guard's `typeof window` check never trips); in the Tauri
      // webview it disables the false-positive guard so the renderer-side provider works.
      dangerouslyAllowBrowser: true,
    });
  }

  /** Lightweight liveness check — does NOT hit the API, just confirms construction. */
  async ping(): Promise<{ ok: boolean }> {
    return { ok: this.apiKey.length > 0 && this.baseURL.startsWith('http') };
  }

  async runTurn(opts: ProviderRunOpts): Promise<ProviderResult> {
    const messages = anthropicShapeToOpenAI(opts.systemPrompt, opts.messages);
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
        max_tokens: opts.maxTokens ?? 8_192,
        temperature: opts.temperature ?? 0.4,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: opts.signal },
    );

    let text = '';
    let thinking = '';
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    let finish: string = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let cacheReadTokens = 0;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta as
        | { content?: string; reasoning_content?: string; tool_calls?: unknown[] }
        | undefined;

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
            completion_tokens_details?: { reasoning_tokens?: number };
          }
        | undefined;
      if (usage) {
        inputTokens = usage.prompt_tokens ?? inputTokens;
        outputTokens = usage.completion_tokens ?? outputTokens;
        cacheReadTokens = usage.prompt_cache_hit_tokens ?? cacheReadTokens;
        reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens;
      }
    }

    // Assemble content blocks
    const content: ContentBlock[] = [];
    if (thinking) {
      content.push({ type: 'thinking', text: thinking });
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
    if (validToolCalls > 0) stopReason = 'tool_use';
    else if (finish === 'length' || truncatedToolCall) stopReason = 'max_tokens';
    else stopReason = 'end_turn';

    return {
      content,
      stopReason,
      usage: { inputTokens, outputTokens, reasoningTokens, cacheReadTokens },
    };
  }
}

function safeParseJson(s: string): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
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
        // thinking blocks are not sent back to the API (they're streaming-only).
      }
      const assistantMsg: Record<string, unknown> = { role: 'assistant' };
      if (textParts.length > 0) assistantMsg.content = textParts.join('\n');
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      out.push(assistantMsg);
    }
  }

  return out;
}

// Exported for tests
export const __internals = { anthropicShapeToOpenAI, safeParseJson };
