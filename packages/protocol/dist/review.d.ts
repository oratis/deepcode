import type { ReviewFindingPayload } from './types.js';
/**
 * Applying a finding is intentionally a new agent turn, never a direct write
 * endpoint, so the normal permission/hook/sandbox/snapshot pipeline remains in force.
 */
export declare function reviewApplyPrompt(finding: ReviewFindingPayload): string;
/** Build a turn that can only perform the conflict-safe snapshot restore tool. */
export declare function reviewRevertPrompt(actionTurnId: string, findingIds: string[]): string;
/** Build one canonical, permission-gated turn for a bounded set of findings. */
export declare function reviewApplyManyPrompt(findings: ReviewFindingPayload[]): string;
export declare function isReviewFindingPayload(value: unknown): value is ReviewFindingPayload;
//# sourceMappingURL=review.d.ts.map