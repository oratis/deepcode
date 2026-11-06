import type { LedgerKind, NewLedgerRecord } from './index.js';
/**
 * The path a read tool opened, or undefined for anything else.
 *
 * Only `Read` and `NotebookEdit`-adjacent single-file reads count. `Grep` and
 * `Glob` take a search *root* and return many paths; calling the root an input
 * would claim a derivation the turn did not make, and enumerating every hit
 * would drown the real inputs in whatever the search happened to sweep up.
 * Provenance is more useful narrow and true than wide and approximate.
 */
export declare function readPathFor(tool: string, input: Record<string, unknown>): string | undefined;
export declare function isRecordableTool(tool: string): boolean;
export declare function ledgerKindForTool(tool: string): LedgerKind | undefined;
export interface ToolCallRecordInput {
    tool: string;
    input: Record<string, unknown>;
    cwd: string;
    /** The user request driving this turn, used as `intent`. */
    intent?: string;
    threadId?: string;
    turnId?: string;
    actor?: string;
    /** Snapshot/checkpoint sequence captured before the call, if any. */
    snapshotSeq?: number;
    /**
     * Absolute paths this turn read before this call. Normalized and deduped
     * here; the caller only has to observe.
     */
    readPaths?: string[];
}
/** Build the record for a completed tool call, or null if the tool isn't recordable. */
export declare function buildToolCallRecord(input: ToolCallRecordInput): NewLedgerRecord | null;
//# sourceMappingURL=record-tool-call.d.ts.map