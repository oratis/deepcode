// Smoke test — guarantees `pnpm test` doesn't fail with 0 tests.
// Real test suites land in M1+.

import { describe, expect, it } from 'vitest';
import { PROJECT_NAME, VERSION } from './index.js';
import { DEEPSEEK_MODELS, DeepSeekProvider, EFFORT_PARAMS } from './providers/deepseek.js';

describe('@deepcode/core skeleton', () => {
  it('exports project metadata', () => {
    expect(PROJECT_NAME).toBe('DeepCode');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes DeepSeek model spec', () => {
    expect(DEEPSEEK_MODELS['deepseek-chat'].ctx).toBe(128_000);
    expect(DEEPSEEK_MODELS['deepseek-reasoner'].maxOutput).toBeLessThanOrEqual(8_192);
  });

  it('honors max_tokens ≤ 8192 for every effort level (API hard limit)', () => {
    for (const [, params] of Object.entries(EFFORT_PARAMS)) {
      expect(params.maxTokens).toBeLessThanOrEqual(8_192);
      expect(params.temperature).toBeGreaterThanOrEqual(0);
      expect(params.temperature).toBeLessThanOrEqual(1);
    }
  });

  it('DeepSeekProvider can be constructed', async () => {
    const p = new DeepSeekProvider({ apiKey: 'sk-test' });
    expect(p.name).toBe('deepseek');
    const pong = await p.ping();
    expect(pong.ok).toBe(true);
  });
});
