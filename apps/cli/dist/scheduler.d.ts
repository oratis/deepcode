import { type CronJob } from '@deepcode/core';
import type { Writable } from 'node:stream';
export interface SchedulerDeps {
    /** "Now" — injectable for tests. Defaults to wall-clock. */
    now?: Date;
    /** Override HOME (tests). */
    home?: string;
    /** Where status/log lines go. Defaults to process.stdout. */
    output?: Writable;
    /** Run a single due job. Injectable for tests; default runs it headlessly. */
    runJob?: (job: CronJob) => Promise<void>;
}
/** Execute every job due at `now`, update lastRunAt, persist. Returns ids run. */
export declare function runSchedulerRun(deps?: SchedulerDeps): Promise<{
    ran: string[];
}>;
export interface CronCliDeps {
    home?: string;
    output?: Writable;
    errOutput?: Writable;
    /** Skip the `launchctl load/unload` side effect (tests). */
    skipLaunchctl?: boolean;
    /** The argv used to launch this process — [execPath, scriptPath, ...]. */
    argv?: string[];
}
export declare function runCronCommand(sub: string[], deps?: CronCliDeps): Promise<number>;
//# sourceMappingURL=scheduler.d.ts.map