import { type ContractEvaluation, type FileContract } from './file-contract.js';
import type { PermissionVerdict } from './permissions.js';
export interface ContractDispatchRequest {
    tool: string;
    input: Record<string, unknown>;
    cwd: string;
}
/**
 * The contract's opinion about one tool call, or `no-match` when it has none —
 * because there is no contract, the tool has no path axis, the argument is
 * missing, or the path lies outside the workspace.
 */
export declare function evaluateContract(contract: FileContract | undefined, req: ContractDispatchRequest): ContractEvaluation;
/** Tools the contract can speak about — exported so docs and tests share one list. */
export declare function contractGovernedTools(): string[];
export interface WithheldResults<T> {
    kept: T[];
    /** How many entries the contract removed. Reported, never itemised. */
    withheld: number;
}
/**
 * Remove search results whose path the contract denies reading.
 *
 * Grep and Glob take a *search root*, so the pre-call gate can only adjudicate
 * where the search starts — not what it finds. A search rooted at the workspace
 * is allowed, and then returns `.env` among its hits, with the matched line
 * attached. The pre-call verdict was correct and the outcome still contradicts
 * the contract; the gap is that the tool produces paths nobody asked about.
 *
 * The decision runs through `evaluatePath`, the same function the gate uses, on
 * a path normalized the same way. There is deliberately no second glob dialect
 * and no translation into ripgrep's exclusion syntax: an approximate copy of the
 * rules that diverges from the original is worse than the gap it closes.
 *
 * Only `deny` withholds. `ask` means "stop and ask before reading this file" and
 * there is nobody to ask mid-search — turning one Grep into two hundred prompts
 * would get the contract deleted, and a path in a result listing is not yet a
 * read. Read the file and the ordinary `ask` still fires.
 *
 * A path outside the workspace is kept, matching the gate: a per-project
 * contract has no authority over `/etc`.
 */
export declare function withholdDeniedReads<T>(contract: FileContract | undefined, cwd: string, items: T[], pathOf: (item: T) => string): WithheldResults<T>;
/** One line naming how much was withheld, without naming any of it. */
export declare function withheldNotice(withheld: number): string | undefined;
/**
 * Combine the tool-rule verdict with the contract verdict, most restrictive
 * winning.
 *
 * `no-match` means "no opinion" and never wins, which is what makes an absent
 * contract a genuine no-op rather than an approximate one: it collapses to the
 * tool verdict exactly.
 *
 * The composition is one-directional by construction — a contract can tighten
 * `allow` to `ask` or `deny`, and can never loosen a `deny` from settings.json.
 * That is why adding a contract cannot reduce existing safety.
 */
export declare function mostRestrictive(a: PermissionVerdict, b: PermissionVerdict): PermissionVerdict;
export interface ContractWarningInput {
    status: 'absent' | 'loaded' | 'invalid';
    contract?: FileContract;
    path?: string;
    error?: string;
    /** Resolved sandbox mode for this run. */
    sandboxMode?: string;
}
/**
 * Operator-facing warnings about a contract's real reach.
 *
 * Pure and host-agnostic so the CLI, `doctor`, and the desktop app print the
 * same words. Both cases here exist to prevent a false sense of enforcement,
 * which is the main risk this feature introduces.
 */
export declare function fileContractWarnings(input: ContractWarningInput): string[];
//# sourceMappingURL=contract-dispatch.d.ts.map