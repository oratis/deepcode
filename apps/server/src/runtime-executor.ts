import {
  type AgentEvent,
  type Effort,
  type Mode,
  type ReviewFinding,
  type RuntimeHost,
  type SessionManager,
  type StoredMessage,
} from '@deepcode/core';
import { EFFORT_PARAMS } from '@deepcode/core/dist/providers/deepseek.js';
import type { CompletedItem, ThreadSnapshot } from '@deepcode/protocol';

import type { TurnExecutionArgs, TurnExecutionItem, TurnExecutor } from './server.js';

export interface RuntimeHostExecutorOptions {
  createHost: (
    cwd: string,
    mode: Mode,
    context: RuntimeHostCreationContext,
  ) => Promise<RuntimeHost | RuntimeHostLease> | RuntimeHost | RuntimeHostLease;
  systemPrompt?: string;
  model?: string;
  sessionManager?: SessionManager;
}

export interface RuntimeHostCreationContext {
  modeExplicit: boolean;
  signal: AbortSignal;
  requestApproval: (toolName: string, reason: string) => Promise<'allow' | 'deny' | 'always'>;
  reviewAction: { kind: 'apply' | 'revert' } | null;
}

export interface RuntimeHostLease {
  host: RuntimeHost;
  systemPrompt?: string;
  model?: string;
  effort?: Effort;
  diagnostics?: Array<{
    source: string;
    code: string;
    severity: 'warning' | 'error';
    message: string;
  }>;
  prepareUserMessage?: (text: string) => Promise<{
    text: string;
    diagnostics: Array<{
      source: string;
      code: string;
      severity: 'warning' | 'error';
      message: string;
    }>;
  }>;
  close?: () => Promise<void> | void;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are DeepCode, an AI coding assistant powered by DeepSeek. Be concise and accurate.';

export class RuntimeHostExecutor implements TurnExecutor {
  constructor(private readonly options: RuntimeHostExecutorOptions) {}

  async execute(args: TurnExecutionArgs) {
    const requestedMode = args.input.mode;
    const modeExplicit = isMode(requestedMode);
    const mode: Mode = modeExplicit ? requestedMode : 'default';
    const reviewAction = readReviewAction(args.input.reviewAction);
    const interactionItems: TurnExecutionItem[] = [];
    const requestApproval = async (toolName: string, reason: string) => {
      const decision = await args.requestApproval(toolName, reason);
      interactionItems.push({
        type: 'approval',
        payload: { toolName, decision, reason },
      });
      return decision;
    };
    const created = await this.options.createHost(args.thread.cwd, mode, {
      modeExplicit,
      signal: args.signal,
      requestApproval,
      reviewAction,
    });
    const lease: RuntimeHostLease = 'host' in created ? created : { host: created };
    try {
      const history = historyFromThread(args.thread);
      const baselineLength = history.length;
      let text = typeof args.input.text === 'string' ? args.input.text : JSON.stringify(args.input);
      for (const diagnostic of lease.diagnostics ?? []) {
        interactionItems.push({ type: 'error', payload: diagnostic });
      }
      if (lease.prepareUserMessage) {
        const prepared = await lease.prepareUserMessage(text);
        text = prepared.text;
        for (const diagnostic of prepared.diagnostics) {
          interactionItems.push({ type: 'error', payload: diagnostic });
        }
      }
      const streamingItemId = `${args.turn.id}-assistant`;
      const events: AgentEvent[] = [];
      const effort = parseEffort(args.input.effort ?? lease.effort);
      const effortParams = EFFORT_PARAMS[effort];
      const result = await lease.host.run({
        cwd: args.thread.cwd,
        systemPrompt: lease.systemPrompt ?? this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        userMessage: text,
        history,
        model:
          typeof args.input.model === 'string'
            ? args.input.model
            : (lease.model ?? this.options.model ?? 'deepseek-chat'),
        maxTokens: effortParams.maxTokens,
        temperature: effortParams.temperature,
        ...(reviewAction?.kind === 'revert' ? { allowedTools: ['RestoreReviewAction'] } : {}),
        signal: args.signal,
        session: this.options.sessionManager
          ? { manager: this.options.sessionManager, id: args.thread.id, turnId: args.turn.id }
          : undefined,
        persistSessionMessages: false,
        systemReminders: false,
        approval: async (toolName, _input, verdict) => {
          const decision = await requestApproval(
            toolName,
            verdict.reason ?? `Approve ${toolName}?`,
          );
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
      const items = [
        ...interactionItems,
        ...reviewFindingsFromEvents(events),
        ...completedItemsFromMessages(newMessages, text),
      ];
      if (result.stopReason === 'error') {
        const error = [...events].reverse().find((event) => event.type === 'error');
        if (error?.type === 'error') {
          items.push({ type: 'error', payload: { message: error.error } });
        }
      }
      return {
        items,
        status: result.stopReason === 'error' ? ('failed' as const) : ('completed' as const),
      };
    } finally {
      await lease.close?.();
    }
  }
}

function readReviewAction(value: unknown): { kind: 'apply' | 'revert' } | null {
  if (!value || typeof value !== 'object') return null;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'apply' || kind === 'revert' ? { kind } : null;
}

export function reviewFindingsFromEvents(events: AgentEvent[]): TurnExecutionItem[] {
  const calls = new Map<string, Record<string, unknown>>();
  const items: TurnExecutionItem[] = [];
  for (const event of events) {
    if (event.type === 'tool_use' && event.name === 'SubmitReviewFinding') {
      calls.set(event.id, event.input);
    } else if (event.type === 'tool_result' && calls.has(event.id) && !event.result.isError) {
      const finding = event.result.data?.finding;
      if (isReviewFinding(finding)) {
        items.push({
          type: 'review_finding',
          payload: { findingId: event.id, ...finding },
        });
      }
      calls.delete(event.id);
    }
  }
  return items;
}

function isReviewFinding(value: unknown): value is ReviewFinding {
  if (!value || typeof value !== 'object') return false;
  const finding = value as Partial<ReviewFinding>;
  return (
    typeof finding.title === 'string' &&
    typeof finding.body === 'string' &&
    typeof finding.path === 'string' &&
    Number.isInteger(finding.startLine) &&
    Number.isInteger(finding.endLine) &&
    Number.isInteger(finding.priority)
  );
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

function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && MODES.has(value as Mode);
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
