// Keep model metadata in a dependency-free module. Renderer surfaces may use
// these values without pulling the provider implementation or OpenAI SDK into
// their production bundle.
export const DEEPSEEK_MODELS = {
    'deepseek-chat': { ctx: 128_000, maxOutput: 8_192 },
    'deepseek-reasoner': { ctx: 128_000, maxOutput: 8_192 },
    'deepseek-v4-flash': { ctx: 128_000, maxOutput: 8_192 },
    'deepseek-v4-pro': { ctx: 128_000, maxOutput: 8_192 },
};
/** Fallback context window for an unrecognized model id. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;
/** Context-window size for a model, with a safe fallback for custom ids. */
export function contextWindowFor(model) {
    return DEEPSEEK_MODELS[model]?.ctx ?? DEFAULT_CONTEXT_WINDOW;
}
//# sourceMappingURL=model-metadata.js.map