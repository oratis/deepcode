import { describe, expect, it } from 'vitest';
import { estimateCost } from './pricing.js';
import type { ProviderUsage } from './types.js';

function usage(p: Partial<ProviderUsage>): ProviderUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, ...p };
}

describe('estimateCost', () => {
  it('prices deepseek-chat input + output with no cache hits', () => {
    const c = estimateCost(
      usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      'deepseek-chat',
    );
    expect(c.cacheMissYuan).toBeCloseTo(1.0, 6);
    expect(c.cacheHitYuan).toBe(0);
    expect(c.outputYuan).toBeCloseTo(2.0, 6);
    expect(c.reasoningYuan).toBe(0);
    expect(c.totalYuan).toBeCloseTo(3.0, 6);
    expect(c.cacheHitRate).toBe(0);
    expect(c.cacheSavingsYuan).toBe(0);
  });

  it('credits cache-hit tokens at 10% (inputTokens is inclusive of cache hits)', () => {
    // 1M input of which 800k are cache hits → 200k miss @¥1/M + 800k hit @¥0.1/M.
    const c = estimateCost(
      usage({ inputTokens: 1_000_000, cacheReadTokens: 800_000 }),
      'deepseek-chat',
    );
    expect(c.cacheMissYuan).toBeCloseTo(0.2, 6); // 200k @ ¥1/M
    expect(c.cacheHitYuan).toBeCloseTo(0.08, 6); // 800k @ ¥0.1/M
    expect(c.totalYuan).toBeCloseTo(0.28, 6);
    expect(c.cacheHitRate).toBeCloseTo(0.8, 6);
    expect(c.cacheSavingsYuan).toBeCloseTo(0.72, 6); // 800k @ (1.0−0.1)/M
  });

  it('prices reasoner output + reasoning higher', () => {
    const c = estimateCost(
      usage({ outputTokens: 1_000_000, reasoningTokens: 1_000_000 }),
      'deepseek-reasoner',
    );
    expect(c.outputYuan).toBeCloseTo(16.0, 6);
    expect(c.reasoningYuan).toBeCloseTo(4.0, 6);
  });

  it('clamps cache hits to input and falls back to chat pricing for unknown models', () => {
    const c = estimateCost(usage({ inputTokens: 100, cacheReadTokens: 999 }), 'mystery-model');
    expect(c.cacheHitRate).toBe(1); // hits clamped to ≤ input
    expect(c.cacheMissYuan).toBe(0); // all input was a cache hit
  });

  it('is zero for an empty session', () => {
    const c = estimateCost(usage({}), 'deepseek-chat');
    expect(c.totalYuan).toBe(0);
    expect(c.cacheHitRate).toBe(0);
  });
});
