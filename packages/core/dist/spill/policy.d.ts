import type { ToolResult } from '../types.js';
import type { SpillSource, SpillStore } from './types.js';
/** Default model-visible ceiling, matching the cap Bash has always applied per stream. */
export declare const DEFAULT_SPILL_THRESHOLD_CHARS = 30000;
export interface SpillPolicyOptions {
    /** Which call produced this result. */
    source: SpillSource;
    /** Where to persist oversized text. Omitted when the host cannot persist. */
    store?: SpillStore;
    /** Model-visible ceiling in code units. Defaults to {@link DEFAULT_SPILL_THRESHOLD_CHARS}. */
    thresholdChars?: number;
}
/** What the policy did, recorded on `ToolResult.data.spill` for the UI. */
export interface SpillOutcome {
    /** Code units in the original result content. */
    originalChars: number;
    /** Code units replaced by the marker. */
    omittedChars: number;
    /** Absent when the content could not be persisted. */
    locator?: string;
    /** Why persistence did not happen, when it did not. */
    unsavedReason?: string;
}
/**
 * Bound a tool result to the model-visible ceiling, persisting the full text
 * when a store is available.
 *
 * Persistence failures are not propagated: a result the model can read in part
 * beats an error, so a failed save degrades to the same preview with the reason
 * stated inline.
 *
 * @param result The tool's own result.
 * @param opts Source attribution, optional store, and threshold.
 * @returns The original result when it fits, otherwise a preview-bearing copy.
 */
export declare function applySpillPolicy(result: ToolResult, opts: SpillPolicyOptions): Promise<ToolResult>;
//# sourceMappingURL=policy.d.ts.map