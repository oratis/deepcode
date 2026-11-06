import type { Effort, StoredMessage } from '../types.js';
import type { Provider, ProviderResult, ProviderRunOpts } from './types.js';
export { DEEPSEEK_MODELS, DEFAULT_CONTEXT_WINDOW, contextWindowFor } from './model-metadata.js';
export interface DeepSeekProviderOpts {
    apiKey: string;
    baseURL?: string;
    /** Bearer token alternative — see §3.4 dual-header design. */
    authToken?: string;
    /** Injected fetch (used in tests). */
    fetch?: typeof globalThis.fetch;
}
/**
 * Effort → DeepSeek API parameters.
 * Numbers from docs/design/effort-levels.md §3.2.
 * NOTE: These are M1-design values; M1 implementation includes a benchmark
 * (`scripts/effort-bench.ts`) to verify and backfill measured numbers.
 */
export declare const EFFORT_PARAMS: Record<Effort, {
    maxTokens: number;
    temperature: number;
}>;
export declare class DeepSeekProvider implements Provider {
    readonly name = "deepseek";
    private readonly client;
    private readonly apiKey;
    private readonly baseURL;
    constructor(opts: DeepSeekProviderOpts);
    /** Lightweight liveness check — does NOT hit the API, just confirms construction. */
    ping(): Promise<{
        ok: boolean;
    }>;
    runTurn(opts: ProviderRunOpts): Promise<ProviderResult>;
}
declare function safeParseJson(s: string): Record<string, unknown> | null;
/**
 * Convert DeepCode-internal messages to OpenAI chat-completions shape.
 * Tool calls / tool results get unfolded into separate `assistant` and `tool` messages.
 */
declare function anthropicShapeToOpenAI(systemPrompt: string, messages: StoredMessage[]): Array<Record<string, unknown>>;
export declare const __internals: {
    anthropicShapeToOpenAI: typeof anthropicShapeToOpenAI;
    safeParseJson: typeof safeParseJson;
};
//# sourceMappingURL=deepseek.d.ts.map