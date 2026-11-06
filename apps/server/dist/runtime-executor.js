import { EFFORT_PARAMS } from '@deepcode/core/dist/providers/deepseek.js';
const DEFAULT_SYSTEM_PROMPT = 'You are DeepCode, an AI coding assistant powered by DeepSeek. Be concise and accurate.';
export class RuntimeHostExecutor {
    options;
    constructor(options) {
        this.options = options;
    }
    async execute(args) {
        const requestedMode = args.input.mode;
        const modeExplicit = isMode(requestedMode);
        const mode = modeExplicit ? requestedMode : 'default';
        const reviewAction = readReviewAction(args.input.reviewAction);
        const interactionItems = [];
        const requestApproval = async (toolName, reason) => {
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
        const lease = 'host' in created ? created : { host: created };
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
            const events = [];
            const effort = parseEffort(args.input.effort ?? lease.effort);
            const effortParams = EFFORT_PARAMS[effort];
            const result = await lease.host.run({
                cwd: args.thread.cwd,
                systemPrompt: lease.systemPrompt ?? this.options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
                userMessage: text,
                history,
                model: typeof args.input.model === 'string'
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
                    const decision = await requestApproval(toolName, verdict.reason ?? `Approve ${toolName}?`);
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
                        case 'thinking_delta':
                            // Reasoning went nowhere: the protocol carried only
                            // reasoningTokens, so DeepSeek's reasoner produced its most
                            // useful output and every client dropped it.
                            args.publishReasoning(`${streamingItemId}-reasoning`, event.text);
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
                status: result.stopReason === 'error' ? 'failed' : 'completed',
            };
        }
        finally {
            await lease.close?.();
        }
    }
}
function readReviewAction(value) {
    if (!value || typeof value !== 'object')
        return null;
    const kind = value.kind;
    return kind === 'apply' || kind === 'revert' ? { kind } : null;
}
export function reviewFindingsFromEvents(events) {
    const calls = new Map();
    const items = [];
    for (const event of events) {
        if (event.type === 'tool_use' && event.name === 'SubmitReviewFinding') {
            calls.set(event.id, event.input);
        }
        else if (event.type === 'tool_result' && calls.has(event.id) && !event.result.isError) {
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
function isReviewFinding(value) {
    if (!value || typeof value !== 'object')
        return false;
    const finding = value;
    return (typeof finding.title === 'string' &&
        typeof finding.body === 'string' &&
        typeof finding.path === 'string' &&
        Number.isInteger(finding.startLine) &&
        Number.isInteger(finding.endLine) &&
        Number.isInteger(finding.priority));
}
const MODES = new Set([
    'default',
    'acceptEdits',
    'plan',
    'auto',
    'dontAsk',
    'bypassPermissions',
]);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
function isMode(value) {
    return typeof value === 'string' && MODES.has(value);
}
function parseEffort(value) {
    return typeof value === 'string' && EFFORTS.has(value) ? value : 'high';
}
export function historyFromThread(thread) {
    const history = [];
    for (const turn of thread.turns) {
        for (const item of turn.items) {
            const message = messageFromItem(item);
            if (message)
                history.push(message);
        }
    }
    return history;
}
function messageFromItem(item) {
    if (item.type === 'user_message' && typeof item.payload.text === 'string') {
        return { role: 'user', content: [{ type: 'text', text: item.payload.text }] };
    }
    const message = item.payload.message;
    if (!isStoredMessage(message))
        return null;
    return message;
}
function completedItemsFromMessages(messages, inputText) {
    const items = [];
    for (const [index, message] of messages.entries()) {
        if (index === 0 && isMatchingInputMessage(message, inputText))
            continue;
        items.push({
            type: message.role === 'assistant' ? 'assistant_message' : 'tool_result',
            payload: { message },
        });
    }
    return items;
}
function isMatchingInputMessage(message, text) {
    return (message.role === 'user' &&
        message.content.length === 1 &&
        message.content[0]?.type === 'text' &&
        message.content[0].text === text);
}
function isStoredMessage(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const candidate = value;
    return ((candidate.role === 'user' || candidate.role === 'assistant') &&
        Array.isArray(candidate.content));
}
//# sourceMappingURL=runtime-executor.js.map