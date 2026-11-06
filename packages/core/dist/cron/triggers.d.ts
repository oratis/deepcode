export type TriggerSource = {
    kind: 'cron';
    schedule: string;
}
/** A local `.ics` file. Standard calendar text, no vendor SDK, no account. */
 | {
    kind: 'ics';
    path: string;
    match?: string;
}
/** Paths whose modification time moving forward is the event. */
 | {
    kind: 'file';
    paths: string[];
};
export interface TriggerContext {
    /** The moment being evaluated. */
    now: Date;
    /** The job's working directory, for resolving relative paths. */
    cwd: string;
    /**
     * When this job last ran. A file trigger compares against it, so a job with
     * no recorded run establishes a baseline instead of firing — otherwise every
     * file trigger fires once the moment it is created, on files that have not
     * changed since anyone cared.
     */
    lastRunAt?: string;
    /** Injectable for tests; defaults to reading the filesystem. */
    readFile?: (path: string) => Promise<string>;
    statMtimeMs?: (path: string) => Promise<number | null>;
}
export interface TriggerVerdict {
    due: boolean;
    /** Shown in the job log — why it fired, or why it could not be evaluated. */
    reason?: string;
    /** Non-fatal problems, e.g. calendar constructs the reader cannot express. */
    diagnostics?: string[];
}
/**
 * The source a job uses.
 *
 * `trigger` wins when present; otherwise the legacy `schedule` string is the
 * source. Jobs written before this existed keep working untouched, and a job
 * file never has to be migrated.
 */
export declare function resolveTrigger(job: {
    schedule?: string;
    trigger?: TriggerSource;
}): TriggerSource;
/** A one-line description for `cron list` and the job log. */
export declare function describeTrigger(source: TriggerSource): string;
export declare function isTriggerDue(source: TriggerSource, ctx: TriggerContext, isCronDue: (schedule: string, date: Date) => boolean): Promise<TriggerVerdict>;
/** Structural validation for a trigger written by a user or a tool. */
export declare function validateTrigger(source: TriggerSource): string | null;
//# sourceMappingURL=triggers.d.ts.map