import type { Effort } from '../types.js';

export type ProviderId = 'deepseek' | 'kimi' | 'glm';
export interface ProviderProfile {
  /** OpenAI Chat Completions endpoint. */
  baseURL?: string;
  /** Separate Anthropic Messages endpoint for the experimental SDK engine. */
  anthropicURL?: string;
  /** Name of an environment variable, never the key itself. */
  apiKeyEnv?: string;
  /** Model default when this provider is selected. */
  model?: string;
  /** Explicit limits for custom model IDs. */
  contextWindow?: number;
  maxOutput?: number;
}
export interface ModelInfo {
  id: string;
  provider: ProviderId;
  contextWindow: number;
  maxOutput: number;
  reasoning: boolean;
}

/** Conservative, versioned presets. Custom IDs use an explicit provider profile. */
export const MODEL_CATALOG: readonly ModelInfo[] = [
  ...['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-pro'].map((id) => ({
    id,
    provider: 'deepseek' as const,
    contextWindow: 128_000,
    maxOutput: 8_192,
    reasoning: id === 'deepseek-reasoner',
  })),
  { id: 'kimi-k2.5', provider: 'kimi', contextWindow: 256_000, maxOutput: 16_384, reasoning: true },
  { id: 'glm-4.7', provider: 'glm', contextWindow: 200_000, maxOutput: 32_768, reasoning: true },
];
export const PROVIDERS: Record<
  ProviderId,
  { baseURL: string; apiKeyEnv: string; model: string; anthropicURL?: string }
> = {
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    model: 'deepseek-chat',
  },
  kimi: {
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    model: 'kimi-k2.5',
    anthropicURL: 'https://api.moonshot.cn/anthropic',
  },
  glm: {
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'GLM_API_KEY',
    model: 'glm-4.7',
    anthropicURL: 'https://open.bigmodel.cn/api/anthropic',
  },
};
export function modelInfo(model: string): ModelInfo | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === model);
}
export function providerForModel(model: string, fallback: ProviderId = 'deepseek'): ProviderId {
  if (/^kimi-/i.test(model)) return 'kimi';
  if (/^glm-/i.test(model)) return 'glm';
  if (/^deepseek-/i.test(model)) return 'deepseek';
  return fallback;
}
export function validModelId(model: unknown): model is string {
  return typeof model === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,159}$/.test(model);
}
export const DEEPSEEK_EFFORT_PARAMS: Record<Effort, { maxTokens: number; temperature: number }> = {
  low: { maxTokens: 1500, temperature: 0.2 },
  medium: { maxTokens: 3000, temperature: 0.4 },
  high: { maxTokens: 6000, temperature: 0.6 },
  xhigh: { maxTokens: 8000, temperature: 0.7 },
  max: { maxTokens: 8192, temperature: 0.8 },
};
/** Budget is an output limit, not a claim of equivalent reasoning effort. */
export function modelParameters(
  model: string,
  effort: Effort = 'medium',
  profile?: ProviderProfile,
  fallback?: ProviderId,
) {
  const provider = providerForModel(model, fallback);
  if (provider === 'deepseek') {
    const { maxTokens, temperature } =
      DEEPSEEK_EFFORT_PARAMS[effort] ?? DEEPSEEK_EFFORT_PARAMS.medium;
    return {
      maxTokens: Math.min(maxTokens, profile?.maxOutput ?? 8192),
      temperature,
    };
  }
  const budget = { low: 4096, medium: 8192, high: 16384, xhigh: 24576, max: 32768 }[effort] ?? 8192;
  return {
    maxTokens: Math.min(budget, profile?.maxOutput ?? modelInfo(model)?.maxOutput ?? 8192),
    temperature: undefined,
  };
}
