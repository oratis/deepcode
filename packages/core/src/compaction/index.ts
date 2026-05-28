// Context compaction — fold middle of conversation into a summary when token
// usage approaches the model's context limit.
// Spec: docs/DEVELOPMENT_PLAN.md §3.7
// Milestone: M3c

import type { Provider } from '../providers/types.js';
import type { ContentBlock, StoredMessage, TextBlock } from '../types.js';

export interface CompactionOpts {
  /** Provider to use for the summarization call. */
  provider: Provider;
  /** Model to use for summarization (default `deepseek-chat` — cheaper). */
  summarizerModel?: string;
  /** Keep the first N user/assistant pairs verbatim (system context anchor). */
  keepFirstPairs?: number;
  /** Keep the last N messages verbatim (active conversation tail). */
  keepLastMessages?: number;
  /** Optional limit on summary token budget. */
  summaryMaxTokens?: number;
}

export interface CompactionResult {
  /** New history: keep-first + summary message + keep-last. */
  history: StoredMessage[];
  /** Number of messages removed from the middle. */
  messagesRemoved: number;
  /** Token usage from the summarizer call. */
  usage: { inputTokens: number; outputTokens: number };
  /** Synthetic summary text (also embedded in the new history). */
  summaryText: string;
}

const DEFAULT_KEEP_FIRST = 1; // first user message
const DEFAULT_KEEP_LAST = 6; // last 3 turns
const DEFAULT_SUMMARY_TOKENS = 1500;

/**
 * Compact a long history. Strategy:
 *   keep first N messages (anchor: the original task)
 *   + 1 synthetic "Conversation summary" assistant message
 *   + keep last M messages (active state)
 *
 * Returns the new history. Caller is responsible for replacing the session's
 * in-memory history with this result.
 */
export async function compact(
  history: StoredMessage[],
  opts: CompactionOpts,
): Promise<CompactionResult> {
  const keepFirst = opts.keepFirstPairs ?? DEFAULT_KEEP_FIRST;
  const keepLast = opts.keepLastMessages ?? DEFAULT_KEEP_LAST;
  if (history.length <= keepFirst + keepLast + 1) {
    return {
      history: [...history],
      messagesRemoved: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      summaryText: '',
    };
  }

  const head = history.slice(0, keepFirst);
  const tail = history.slice(-keepLast);
  const middle = history.slice(keepFirst, history.length - keepLast);

  const summaryPrompt = buildSummaryPrompt(middle);

  const result = await opts.provider.runTurn({
    model: opts.summarizerModel ?? 'deepseek-chat',
    systemPrompt:
      'You compress long agent conversations. Output a TERSE summary preserving: ' +
      '(1) what files were read/modified and key contents; ' +
      '(2) what bugs/insights were discovered; ' +
      '(3) what was decided. Drop verbose tool output. Use bullet points. No preamble.',
    tools: [],
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: summaryPrompt }],
      },
    ],
    maxTokens: opts.summaryMaxTokens ?? DEFAULT_SUMMARY_TOKENS,
    temperature: 0.2,
  });

  const summaryText =
    result.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim() || '[compaction failed — no summary returned]';

  const summaryMsg: StoredMessage = {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: `[Conversation compacted — ${middle.length} messages summarized below]\n\n${summaryText}`,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  return {
    history: [...head, summaryMsg, ...tail],
    messagesRemoved: middle.length,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
    summaryText,
  };
}

function buildSummaryPrompt(middle: StoredMessage[]): string {
  const lines: string[] = ['Summarize this conversation segment:'];
  lines.push('');
  for (const msg of middle) {
    const role = msg.role === 'user' ? 'USER' : 'ASSISTANT';
    for (const block of msg.content) {
      const flat = renderBlockBrief(block);
      if (flat) lines.push(`${role}: ${flat}`);
    }
  }
  return lines.join('\n');
}

function renderBlockBrief(block: ContentBlock): string {
  if (block.type === 'text') return block.text.slice(0, 500);
  if (block.type === 'thinking') return ''; // skip thinking — internal
  if (block.type === 'tool_use')
    return `[tool: ${block.name} ${truncate(JSON.stringify(block.input), 200)}]`;
  if (block.type === 'tool_result')
    return `[tool result${block.is_error ? ' (error)' : ''}: ${truncate(block.content, 300)}]`;
  return '';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * Decide whether compaction is needed based on token usage.
 * Trigger at 80% of context window by default; configurable via threshold.
 */
export function shouldCompact(usage: {
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  threshold?: number;
}): boolean {
  const used = usage.inputTokens + usage.outputTokens;
  const ratio = used / usage.contextWindow;
  return ratio >= (usage.threshold ?? 0.8);
}
