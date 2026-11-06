import type { TriggerProfile } from './profile.js';
import { type TriggerSource, type TriggerVerdict } from './triggers.js';
/**
 * What an unattended run does when a tool call resolves to `ask`.
 *
 * `deny` (default, and the pre-existing behaviour) refuses that one call and
 * lets the run continue. `abort` stops the whole run instead — the right choice
 * when a half-executed job is worse than no job, since a denied first call
 * otherwise leaves the agent looping against a wall while it burns tokens.
 */
export type UnattendedApprovalPolicy = 'deny' | 'abort';
export interface CronJob {
    id: string;
    /**
     * 5-field cron expression: "min hour day-of-month month day-of-week".
     *
     * Still the source when `trigger` is absent, which is every job written
     * before triggers existed. Kept rather than migrated: a store nobody has to
     * rewrite is a store that cannot be rewritten wrongly.
     */
    schedule: string;
    /**
     * Where this job's events come from. Absent means the `schedule` above.
     */
    trigger?: TriggerSource;
    /** Prompt to run headlessly when the job fires. */
    prompt: string;
    /** Working directory to run in. */
    cwd: string;
    createdAt: string;
    lastRunAt?: string;
    enabled: boolean;
    /**
     * Unattended approval policy for this job. Absent on jobs created before this
     * field existed, which is why every read goes through
     * `resolveUnattendedApproval` instead of touching the field directly.
     */
    onApprovalRequired?: UnattendedApprovalPolicy;
    /**
     * Permission posture for this job, independent of the interactive settings it
     * would otherwise inherit. Absent means "use the ambient settings, clamped" —
     * see `resolveTriggerMode`.
     */
    profile?: TriggerProfile;
}
/** The effective policy for a job, defaulting to the historical `deny`. */
export declare function resolveUnattendedApproval(job: Pick<CronJob, 'onApprovalRequired'>): UnattendedApprovalPolicy;
export interface CronStore {
    jobs: CronJob[];
}
export declare function cronStorePath(home?: string): string;
export declare function loadCronStore(home?: string): Promise<CronStore>;
export declare function saveCronStore(store: CronStore, home?: string): Promise<void>;
export declare function addCronJob(job: {
    schedule: string;
    prompt: string;
    cwd: string;
    onApprovalRequired?: UnattendedApprovalPolicy;
    profile?: TriggerProfile;
}, home?: string): Promise<CronJob>;
export declare function removeCronJob(id: string, home?: string): Promise<boolean>;
export declare function listCronJobs(home?: string): Promise<CronJob[]>;
/** Returns an error message if `expr` is not a valid 5-field cron, else null. */
export declare function validateCronExpr(expr: string): string | null;
/** Is `date` a firing time for `schedule`? (minute granularity.) */
export declare function isCronDue(schedule: string, date: Date): boolean;
/**
 * Enabled jobs due to run at `now`.
 *
 * Synchronous and cron-only. Kept because it is the shape every existing caller
 * and test uses, and because a clock trigger needs nothing but the clock — but
 * a job with a non-cron trigger is not decidable here, so it is skipped rather
 * than guessed at. Use `dueJobsWithTriggers` to evaluate all of them.
 */
export declare function dueJobs(jobs: CronJob[], now: Date): CronJob[];
export interface DueJob {
    job: CronJob;
    verdict: TriggerVerdict;
}
/**
 * Every enabled job whose trigger has fired, whatever kind it is.
 *
 * Async because a calendar has to be read and a watched file has to be stat'd.
 * Diagnostics ride along on the verdict so the scheduler can log "this
 * calendar has an RRULE I cannot express" next to the job it belongs to,
 * instead of on nobody's behalf.
 */
export declare function dueJobsWithTriggers(jobs: CronJob[], now: Date): Promise<DueJob[]>;
export { describeTrigger, isTriggerDue, resolveTrigger, validateTrigger, type TriggerContext, type TriggerSource, type TriggerVerdict, } from './triggers.js';
export { matchingEvents, occursAt, parseIcs, type IcsCalendar, type IcsEvent, type IcsRecurrence, } from './ics.js';
export { describeClamp, resolveTriggerMode, tightenPermissions, tightenSandbox, type ResolvedTriggerMode, type TriggerProfile, } from './profile.js';
//# sourceMappingURL=index.d.ts.map