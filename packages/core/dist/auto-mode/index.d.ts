import type { AutoModeConfig } from '../config/types.js';
import type { Provider } from '../providers/types.js';
export type AutoVerdict = 'allow' | 'ask' | 'deny';
export interface ClassifyOpts {
    /** Tool call to judge. */
    toolName: string;
    toolInput: Record<string, unknown>;
    /** AutoModeConfig from settings. Undefined → no static rules; LLM only. */
    config?: AutoModeConfig;
    /** Provider for the LLM judge. Required unless config decides statically. */
    provider?: Provider;
    /** Model id for the judge call. Defaults to config.model or deepseek-chat. */
    model?: string;
}
/**
 * Decide whether a tool call is allowed under auto mode.
 *
 * Order:
 *   1. allow[] match → 'allow' (no LLM call)
 *   2. hard_deny[] match → 'deny'
 *   3. soft_deny[] match → 'ask'
 *   4. LLM classifier on the primary input string
 *   5. fallback ('ask' default)
 */
export declare function classifyAutoMode(opts: ClassifyOpts): Promise<AutoVerdict>;
//# sourceMappingURL=index.d.ts.map