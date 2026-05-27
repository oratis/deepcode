// Provider interface — DeepSeek today, extensible to other OpenAI-compatible providers.
// Spec: docs/DEVELOPMENT_PLAN.md §3.1

import type { ContentBlock, StoredMessage, ToolDefinition } from '../types.js';

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
}

export interface ProviderResult {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';
  usage: ProviderUsage;
}

export interface ProviderStreamHandlers {
  onTextDelta?: (text: string) => void;
  onThinkingDelta?: (text: string) => void;
}

export interface ProviderRunOpts {
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  messages: StoredMessage[];
  maxTokens?: number;
  temperature?: number;
  handlers?: ProviderStreamHandlers;
  signal?: AbortSignal;
}

export interface Provider {
  readonly name: string;
  runTurn(opts: ProviderRunOpts): Promise<ProviderResult>;
}
