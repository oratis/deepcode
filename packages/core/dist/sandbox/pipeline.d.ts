export interface Clause {
    command: string;
    /** Index in the original string where the clause starts. */
    start: number;
    /** Operator that came BEFORE this clause (empty for first clause). */
    precedingOp: '' | '&&' | '||' | ';' | '|';
}
export declare function splitClauses(input: string): Clause[];
/**
 * Returns true if EVERY clause's leading token (the command name) appears in
 * the excluded list. If ANY clause has a non-excluded leader, return false —
 * the call must be sandboxed.
 *
 * This is the right semantics for the "excluded command" bypass: the entire
 * pipeline must be excluded, not just the first clause.
 */
export declare function allClausesExcluded(input: string, excluded: string[]): boolean;
//# sourceMappingURL=pipeline.d.ts.map