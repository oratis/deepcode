import type { ProviderUsage } from './types.js';
export interface CostBreakdown {
    /** Cache-miss input cost (¥). */
    cacheMissYuan: number;
    /** Cache-hit input cost (¥) — the discounted prompt-cache reads. */
    cacheHitYuan: number;
    outputYuan: number;
    reasoningYuan: number;
    totalYuan: number;
    /** cacheReadTokens / inputTokens, 0..1 (0 when no input). */
    cacheHitRate: number;
    /** ¥ saved vs paying the full miss price for every input token. */
    cacheSavingsYuan: number;
}
/**
 * Estimate session cost in CNY from cumulative usage, crediting DeepSeek's
 * cheaper cache-hit input tokens. Unknown models fall back to deepseek-chat
 * pricing. Pure — safe to call anywhere.
 */
export declare function estimateCost(usage: ProviderUsage, model: string): CostBreakdown;
//# sourceMappingURL=pricing.d.ts.map