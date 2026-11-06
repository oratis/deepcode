// Context compaction — fold middle of conversation into a summary when token
// usage approaches the model's context limit.
// Spec: docs/DEVELOPMENT_PLAN.md §3.7
// Milestone: M3c
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
export async function compact(history, opts) {
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
        systemPrompt: 'You compress long agent conversations. Output a TERSE summary preserving: ' +
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
    const summaryText = result.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim() || '[compaction failed — no summary returned]';
    const summaryMsg = {
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
function buildSummaryPrompt(middle) {
    const lines = ['Summarize this conversation segment:'];
    lines.push('');
    for (const msg of middle) {
        const role = msg.role === 'user' ? 'USER' : 'ASSISTANT';
        for (const block of msg.content) {
            const flat = renderBlockBrief(block);
            if (flat)
                lines.push(`${role}: ${flat}`);
        }
    }
    return lines.join('\n');
}
function renderBlockBrief(block) {
    if (block.type === 'text')
        return block.text.slice(0, 500);
    if (block.type === 'thinking')
        return ''; // skip thinking — internal
    if (block.type === 'tool_use')
        return `[tool: ${block.name} ${truncate(JSON.stringify(block.input), 200)}]`;
    if (block.type === 'tool_result')
        return `[tool result${block.is_error ? ' (error)' : ''}: ${truncate(block.content, 300)}]`;
    return '';
}
function truncate(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
}
/**
 * Decide whether compaction is needed based on token usage.
 * Trigger at 80% of context window by default; configurable via threshold.
 */
export function shouldCompact(usage) {
    const used = usage.inputTokens + usage.outputTokens;
    const ratio = used / usage.contextWindow;
    return ratio >= (usage.threshold ?? 0.8);
}
//# sourceMappingURL=index.js.map