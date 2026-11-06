import type { DeepSeekModel } from '../types.js';
export declare const DEEPSEEK_MODELS: Record<DeepSeekModel, {
    ctx: number;
    maxOutput: number;
}>;
/** Fallback context window for an unrecognized model id. */
export declare const DEFAULT_CONTEXT_WINDOW = 128000;
/** Context-window size for a model, with a safe fallback for custom ids. */
export declare function contextWindowFor(model: string): number;
//# sourceMappingURL=model-metadata.d.ts.map