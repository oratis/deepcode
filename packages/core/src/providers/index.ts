// Provider registry — DeepSeek primary, more provider implementations can plug in here.
// Spec: docs/DEVELOPMENT_PLAN.md §3.1

export type {
  Provider,
  ProviderResult,
  ProviderRunOpts,
  ProviderUsage,
  ProviderStreamHandlers,
} from './types.js';
export { DeepSeekProvider, DEEPSEEK_MODELS, EFFORT_PARAMS } from './deepseek.js';
export type { DeepSeekProviderOpts } from './deepseek.js';
