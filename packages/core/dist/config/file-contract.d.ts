import type { PermissionVerdict } from './permissions.js';
export type ContractAction = 'read' | 'write' | 'execute';
export type ContractDecision = 'allow' | 'ask' | 'deny';
/** Responsibility, not access control — it shapes wording and conflict handling. */
export type ContractOwner = 'human' | 'agent' | 'shared';
export interface FileContractRule {
    glob: string;
    owner?: ContractOwner;
    read?: ContractDecision;
    write?: ContractDecision;
    execute?: ContractDecision;
    /** Shown verbatim when this rule produces an `ask` or `deny`. */
    reason?: string;
}
export interface FileContract {
    version: 1;
    defaults: Record<ContractAction, ContractDecision>;
    rules: FileContractRule[];
}
/** Applied when a contract declares no `defaults` block. */
export declare const DEFAULT_CONTRACT_DEFAULTS: Record<ContractAction, ContractDecision>;
export declare class FileContractError extends Error {
    readonly line?: number | undefined;
    constructor(message: string, line?: number | undefined);
}
export interface ContractRequest {
    /** Workspace-relative POSIX path, from `normalizeContractPath`. */
    path: string;
    action: ContractAction;
}
export interface ContractEvaluation {
    verdict: PermissionVerdict;
    /** The glob that decided, absent when the answer came from `defaults`. */
    rule?: string;
    /** Author-supplied explanation, surfaced to the user on ask/deny. */
    reason?: string;
}
/**
 * Decide one (path, action) pair. Pure.
 *
 * Precedence follows the contract's own stated rule: the more specific glob
 * wins, and equal specificity resolves to the later rule — so a broad default
 * near the top can be narrowed further down without reordering the file.
 */
export declare function evaluatePath(contract: FileContract | undefined, req: ContractRequest): ContractEvaluation;
/**
 * Express `filePath` as a workspace-relative POSIX path, or null when it falls
 * outside the workspace.
 *
 * Outside paths are the sandbox's problem, not the contract's: a contract is a
 * per-project document and has no authority over `/etc`. Returning null keeps
 * `evaluatePath` from inventing an opinion it cannot justify.
 *
 * Pure string math — no `realpath`. A symlink inside the workspace pointing out
 * of it still normalizes to an inside-looking path. See the module header: the
 * sandbox is the boundary, this is policy.
 */
export declare function normalizeContractPath(cwd: string, filePath: string): string | null;
/**
 * Supported syntax: `*` (within a segment), `**` (across segments), `?`, and
 * `{a,b}` alternation. Intentionally small — every construct here has to be
 * explainable in the docs, and a contract nobody can read is a contract nobody
 * audits.
 */
export declare function globMatches(glob: string, path: string): boolean;
type SpecificityRank = {
    doubleStars: number;
    segments: number;
    literals: number;
};
/**
 * Rank a glob so "more specific" is decidable without asking the author to
 * order the file carefully.
 *
 * Fewer `**` beats more (`src/*.ts` over `**\/*.ts`); then more path segments
 * beats fewer (`src/a/**` over `src/**`); then more literal characters beats
 * fewer (`**\/.env*` over `**\/*`).
 */
export declare function specificity(glob: string): SpecificityRank;
/**
 * Parse the contract's YAML subset.
 *
 * The repo carries no YAML dependency on purpose (see `skills/frontmatter.ts`),
 * and a contract file has exactly one shape, so a focused strict parser beats
 * a general permissive one: anything it does not recognise throws instead of
 * being dropped. A silently-ignored `deny` line is the worst possible failure
 * for this particular file.
 */
export declare function parseFileContract(raw: string): FileContract;
export {};
//# sourceMappingURL=file-contract.d.ts.map