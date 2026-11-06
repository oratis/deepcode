import { type Snapshot } from '../sessions/snapshots.js';
import type { ApplyPlan } from '../runtime/apply-ceremony.js';
import type { LedgerRecord } from './index.js';
export interface RollbackContext {
    record: LedgerRecord;
    sessionsRoot: string;
    cwd: string;
}
export type RollbackPlanResult = {
    status: 'ready';
    plan: ApplyPlan<string[]>;
    snapshot: Snapshot;
} | {
    status: 'unavailable';
    reason: string;
};
/**
 * Build a rollback plan for a ledger record, or explain why there isn't one.
 *
 * Returns `unavailable` rather than throwing for the ordinary cases — no
 * rollback hint, no session, a pruned snapshot. Those are expected states of an
 * audit log, not errors, and the user needs the reason more than a stack trace.
 */
export declare function planRollback(ctx: RollbackContext): Promise<RollbackPlanResult>;
//# sourceMappingURL=rollback.d.ts.map