// Module: providers/deepseek
// Milestone: M1
// Spec: docs/DEVELOPMENT_PLAN.md §3.1
// Status: placeholder — actual streaming agent loop integration in M1

import type { DeepSeekModel, Effort } from '../types.js';

export interface DeepSeekProviderOpts {
  apiKey: string;
  baseURL?: string;
  authToken?: string; // Bearer alternative — see §3.4
}

export class DeepSeekProvider {
  readonly name = 'deepseek';
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(opts: DeepSeekProviderOpts) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL ?? 'https://api.deepseek.com/v1';
  }

  // Real implementation lands in M1 — see DEVELOPMENT_PLAN.md §3.1
  async ping(): Promise<{ ok: boolean }> {
    return { ok: this.apiKey.length > 0 && this.baseURL.startsWith('http') };
  }
}

export const DEEPSEEK_MODELS: Record<DeepSeekModel, { ctx: number; maxOutput: number }> = {
  'deepseek-chat': { ctx: 128_000, maxOutput: 8_192 },
  'deepseek-reasoner': { ctx: 128_000, maxOutput: 8_192 },
};

// effort → params mapping placeholder. Real numbers replaced by M1 measurement
// (docs/design/effort-levels.md §6).
export const EFFORT_PARAMS: Record<Effort, { maxTokens: number; temperature: number }> = {
  low: { maxTokens: 1_500, temperature: 0.2 },
  medium: { maxTokens: 3_000, temperature: 0.4 },
  high: { maxTokens: 6_000, temperature: 0.6 },
  xhigh: { maxTokens: 8_000, temperature: 0.7 },
  max: { maxTokens: 8_192, temperature: 0.8 },
};
