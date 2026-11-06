export type ApplyDecision = 'accept' | 'reject' | 'defer';
/** Why an application is safe to accept — Selfware §6.3 step 1. */
export interface ApplyExplanation {
    /** Where the change comes from. */
    source: string;
    /** How the current and proposed states were compared. */
    method: string;
    /** What will physically happen on accept. */
    application: string;
    /** How to get back, in the user's own hands. */
    rollback: string;
}
/** What the user is shown before deciding. */
export interface ApplyPresentation {
    title: string;
    explanation: ApplyExplanation;
    /** Diff lines, a file list, or whatever makes the change concrete. */
    preview: string[];
    /**
     * Conditions that make this riskier than usual — later edits that would be
     * discarded, a file changed outside DeepCode. Never empty-by-omission: a
     * caller that detects nothing passes `[]` deliberately.
     */
    warnings: string[];
}
export interface ApplyPlan<T> extends ApplyPresentation {
    /** Create a restore point. Runs after accept, before `apply`. */
    createRollbackPoint?: () => Promise<string | undefined>;
    apply: () => Promise<T>;
}
export type ApplyConfirm = (presentation: ApplyPresentation) => Promise<ApplyDecision>;
export interface ApplyOutcome<T> {
    status: 'applied' | 'rejected' | 'deferred' | 'failed';
    result?: T;
    /** Identifier of the restore point taken before applying, when one was. */
    rollbackPoint?: string;
    error?: Error;
}
/**
 * Run the ceremony. Applies only on an explicit `accept`.
 *
 * Rejection is not a failure — Selfware §6.3 requires the current version stay
 * working after a reject, so `rejected` and `deferred` are ordinary outcomes
 * and neither throws.
 */
export declare function applyWithCeremony<T>(plan: ApplyPlan<T>, confirm: ApplyConfirm): Promise<ApplyOutcome<T>>;
/** Render a presentation as plain text, so every host words it the same way. */
export declare function renderApplyPresentation(p: ApplyPresentation): string;
//# sourceMappingURL=apply-ceremony.d.ts.map