// Provider registry — DeepSeek primary, more provider implementations can plug in here.
// Spec: docs/DEVELOPMENT_PLAN.md §3.1

export type {
  Provider,
  ProviderResult,
  ProviderRunOpts,
  ProviderUsage,
  ProviderStreamHandlers,
} from './types.js';
export {
  DeepSeekProvider,
  DEEPSEEK_MODELS,
  DEFAULT_CONTEXT_WINDOW,
  EFFORT_PARAMS,
  contextWindowFor,
} from './deepseek.js';
export type { DeepSeekProviderOpts } from './deepseek.js';
export { estimateCost } from './pricing.js';
export type { CostBreakdown } from './pricing.js';
