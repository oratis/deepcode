import type { Provider } from '../providers/types.js';
import type { StoredMessage } from '../types.js';
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
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
    /** Synthetic summary text (also embedded in the new history). */
    summaryText: string;
}
/**
 * Compact a long history. Strategy:
 *   keep first N messages (anchor: the original task)
 *   + 1 synthetic "Conversation summary" assistant message
 *   + keep last M messages (active state)
 *
 * Returns the new history. Caller is responsible for replacing the session's
 * in-memory history with this result.
 */
export declare function compact(history: StoredMessage[], opts: CompactionOpts): Promise<CompactionResult>;
/**
 * Decide whether compaction is needed based on token usage.
 * Trigger at 80% of context window by default; configurable via threshold.
 */
export declare function shouldCompact(usage: {
    inputTokens: number;
    outputTokens: number;
    contextWindow: number;
    threshold?: number;
}): boolean;
//# sourceMappingURL=index.d.ts.map