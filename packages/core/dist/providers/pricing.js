// DeepSeek cost estimation (CNY), crediting server-side prompt caching.
// Prices per docs/design/effort-levels.md §2.4 (per 1M tokens):
//   model              input(miss)  cache-hit  output   reasoning
//   deepseek-chat      ¥1           ¥0.1       ¥2       —
//   deepseek-reasoner  ¥1           ¥0.1       ¥16      ¥4 (reasoning_content)
//
// DeepSeek's `prompt_tokens` (→ usage.inputTokens) is INCLUSIVE of the
// cache-hit tokens (→ usage.cacheReadTokens), so cache-miss = input − cache-hit.
// Cache hits bill at ~10% of a miss, so crediting them matters for long sessions
// with a stable prompt prefix (the agent's system prompt + early turns).
const PRICING = {
    'deepseek-chat': { inputMissPerM: 1.0, cacheHitPerM: 0.1, outputPerM: 2.0, reasoningPerM: 0 },
    'deepseek-reasoner': {
        inputMissPerM: 1.0,
        cacheHitPerM: 0.1,
        outputPerM: 16.0,
        reasoningPerM: 4.0,
    },
};
/**
 * Estimate session cost in CNY from cumulative usage, crediting DeepSeek's
 * cheaper cache-hit input tokens. Unknown models fall back to deepseek-chat
 * pricing. Pure — safe to call anywhere.
 */
export function estimateCost(usage, model) {
    const p = PRICING[model] ?? PRICING['deepseek-chat'];
    const hitTokens = Math.max(0, Math.min(usage.cacheReadTokens, usage.inputTokens));
    const missTokens = Math.max(0, usage.inputTokens - hitTokens);
    const cacheMissYuan = (missTokens / 1_000_000) * p.inputMissPerM;
    const cacheHitYuan = (hitTokens / 1_000_000) * p.cacheHitPerM;
    const outputYuan = (usage.outputTokens / 1_000_000) * p.outputPerM;
    const reasoningYuan = (usage.reasoningTokens / 1_000_000) * p.reasoningPerM;
    // What those cache-hit tokens WOULD have cost at the miss price, minus what
    // they actually cost — i.e. the prompt-cache discount.
    const cacheSavingsYuan = (hitTokens / 1_000_000) * (p.inputMissPerM - p.cacheHitPerM);
    return {
        cacheMissYuan,
        cacheHitYuan,
        outputYuan,
        reasoningYuan,
        totalYuan: cacheMissYuan + cacheHitYuan + outputYuan + reasoningYuan,
        cacheHitRate: usage.inputTokens > 0 ? hitTokens / usage.inputTokens : 0,
        cacheSavingsYuan,
    };
}
//# sourceMappingURL=pricing.js.map