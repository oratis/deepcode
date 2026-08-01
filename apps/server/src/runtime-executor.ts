import {
  type AgentEvent,
  type Effort,
  type Mode,
  type RuntimeHost,
  type SessionManager,
  type StoredMessage,
} from '@deepcode/core';
import { EFFORT_PARAMS } from '@deepcode/core/dist/providers/deepseek.js';
import type { CompletedItem, ThreadSnapshot } from '@deepcode/protocol';

import type { TurnExecutionArgs, TurnExecutionItem, TurnExecutor } from './server.js';

export interface RuntimeHostExecutorOptions {
  createHost: (cwd: string, mode: Mode) => Promise<RuntimeHost> | RuntimeHost;
  systemPrompt?: string;
  model?: string;
  sessionManager?: SessionManager;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are DeepCode, an AI coding assistant powered by DeepSeek. Be concise and accurate.';

export class RuntimeHostExecutor implements TurnExecutor {
  constructor(private readonly options: RuntimeHostExecutorOptions) {}

  async execute(args: TurnExecutionArgs) {
    const mode = parseMode(args.input.mode);
    const host = await this.options.createHost(args.thread.cwd, mode);
    const history = historyFromThread(args.thread);
    const baselineLength = history.length;
    const text = typeof args.input.text === 'string' ? args.input.text : JSON.stringify(args.input);
    const streamingItemId = `${args.turn.id}-assistant`;
    const events: AgentEvent[] = [];
    const interactionItems: TurnExecutionItem[] = [];
    const effort = parseEffort(args.input.effort);
    const effortParams = EFFORT_PARAMS[effort];
    const result = await host.run({
      cwd: args.thread.cwd,
      systemPrompt: this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      userMessage: text,
      history,
      model:
        typeof args.input.model === 'string'
          ? args.input.model
          : (this.options.model ?? 'deepseek-chat'),
      maxTokens: effortParams.maxTokens,
      temperature: effortParams.temperature,
      signal: args.signal,
      session: this.options.sessionManager
        ? { manager: this.options.sessionManager, id: args.thread.id }
        : undefined,
      persistSessionMessages: false,
      systemReminders: false,
      approval: async (toolName, _input, verdict) => {
        const decision = await args.requestApproval(
          toolName,
          verdict.reason ?? `Approve ${toolName}?`,
        );
        interactionItems.push({
          type: 'approval',
          payload: { toolName, decision, reason: verdict.reason },
        });
        return decision === 'always' ? 'always' : decision === 'allow';
      },
      askUser: async (request) => {
        const answer = await args.requestUserInput(request);
        interactionItems.push({ type: 'ask_user', payload: { ...request, answer } });
        return answer;
      },
      onEvent: (event) => {
        events.push(event);
        switch (event.type) {
          case 'text_delta':
            args.publishDelta(streamingItemId, event.text);
            break;
          case 'tool_use':
            args.publishToolStarted(event.id, event.name, event.input);
            break;
          case 'tool_result':
            args.publishToolCompleted(event.id, event.result);
            break;
          case 'usage':
            args.publishUsage({
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              reasoningTokens: event.reasoningTokens,
              cacheReadTokens: event.cacheReadTokens,
            });
            break;
        }
      },
    });

    const newMessages = result.history.slice(baselineLength);
    const items = [...interactionItems, ...completedItemsFromMessages(newMessages, text)];
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

const MODES = new Set<Mode>([
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
  'bypassPermissions',
]);
const EFFORTS = new Set<Effort>(['low', 'medium', 'high', 'xhigh', 'max']);

function parseMode(value: unknown): Mode {
  return typeof value === 'string' && MODES.has(value as Mode) ? (value as Mode) : 'default';
}

function parseEffort(value: unknown): Effort {
  return typeof value === 'string' && EFFORTS.has(value as Effort) ? (value as Effort) : 'high';
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
