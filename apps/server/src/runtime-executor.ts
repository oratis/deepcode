import { type AgentEvent, type RuntimeHost, type StoredMessage } from '@deepcode/core';
import type { CompletedItem, ThreadSnapshot } from '@deepcode/protocol';

import type { TurnExecutionArgs, TurnExecutionItem, TurnExecutor } from './server.js';

export interface RuntimeHostExecutorOptions {
  createHost: (cwd: string) => Promise<RuntimeHost> | RuntimeHost;
  systemPrompt?: string;
  model?: string;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are DeepCode, an AI coding assistant powered by DeepSeek. Be concise and accurate.';

export class RuntimeHostExecutor implements TurnExecutor {
  constructor(private readonly options: RuntimeHostExecutorOptions) {}

  async execute(args: TurnExecutionArgs) {
    const host = await this.options.createHost(args.thread.cwd);
    const history = historyFromThread(args.thread);
    const baselineLength = history.length;
    const text = typeof args.input.text === 'string' ? args.input.text : JSON.stringify(args.input);
    const streamingItemId = `${args.turn.id}-assistant`;
    const events: AgentEvent[] = [];
    const result = await host.run({
      cwd: args.thread.cwd,
      systemPrompt: this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      userMessage: text,
      history,
      model: this.options.model ?? 'deepseek-chat',
      signal: args.signal,
      systemReminders: false,
      approval: async () => false,
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'text_delta') args.publishDelta(streamingItemId, event.text);
      },
    });

    const newMessages = result.history.slice(baselineLength);
    const items = completedItemsFromMessages(newMessages, text);
    if (result.stopReason === 'error') {
      const error = [...events].reverse().find((event) => event.type === 'error');
      if (error?.type === 'error') items.push({ type: 'error', payload: { message: error.error } });
    }
    return {
      items,
      status: result.stopReason === 'error' ? ('failed' as const) : ('completed' as const),
    };
  }
}

export function historyFromThread(thread: ThreadSnapshot): StoredMessage[] {
  const history: StoredMessage[] = [];
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      const message = messageFromItem(item);
      if (message) history.push(message);
    }
  }
  return history;
}

function messageFromItem(item: CompletedItem): StoredMessage | null {
  if (item.type === 'user_message' && typeof item.payload.text === 'string') {
    return { role: 'user', content: [{ type: 'text', text: item.payload.text }] };
  }
  const message = item.payload.message;
  if (!isStoredMessage(message)) return null;
  return message;
}

function completedItemsFromMessages(
  messages: StoredMessage[],
  inputText: string,
): TurnExecutionItem[] {
  const items: TurnExecutionItem[] = [];
  for (const [index, message] of messages.entries()) {
    if (index === 0 && isMatchingInputMessage(message, inputText)) continue;
    items.push({
      type: message.role === 'assistant' ? 'assistant_message' : 'tool_result',
      payload: { message },
    });
  }
  return items;
}

function isMatchingInputMessage(message: StoredMessage, text: string): boolean {
  return (
    message.role === 'user' &&
    message.content.length === 1 &&
    message.content[0]?.type === 'text' &&
    message.content[0].text === text
  );
}

function isStoredMessage(value: unknown): value is StoredMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredMessage>;
  return (
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    Array.isArray(candidate.content)
  );
}
