// Cron — scheduled agent tasks. Stores jobs in ~/.deepcode/cron.json and matches
// 5-field cron expressions. The CronCreate/CronList/CronDelete tools CRUD the
// store; a separate `deepcode scheduler run` (CLI) executes due jobs.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.4 / §0.1 (CronCreate family)
import { promises as fs } from 'node:fs';
import { isTriggerDue, resolveTrigger, } from './triggers.js';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/** The effective policy for a job, defaulting to the historical `deny`. */
export function resolveUnattendedApproval(job) {
    return job.onApprovalRequired === 'abort' ? 'abort' : 'deny';
}
export function cronStorePath(home = homedir()) {
    return join(home, '.deepcode', 'cron.json');
}
export async function loadCronStore(home = homedir()) {
    try {
        const raw = await fs.readFile(cronStorePath(home), 'utf8');
        const parsed = JSON.parse(raw);
        return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return { jobs: [] };
        throw err;
    }
}
export async function saveCronStore(store, home = homedir()) {
    const path = cronStorePath(home);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify(store, null, 2) + '\n', 'utf8');
}
let cronSeq = 0;
function newCronId() {
    return `cron-${Date.now().toString(36)}-${(cronSeq++).toString(36)}`;
}
export async function addCronJob(job, home = homedir()) {
    const invalid = validateCronExpr(job.schedule);
    if (invalid)
        throw new Error(invalid);
    const store = await loadCronStore(home);
    const created = {
        id: newCronId(),
        schedule: job.schedule.trim(),
        prompt: job.prompt,
        cwd: job.cwd,
        createdAt: new Date().toISOString(),
        enabled: true,
        ...(job.onApprovalRequired ? { onApprovalRequired: job.onApprovalRequired } : {}),
        ...(job.profile ? { profile: job.profile } : {}),
    };
    store.jobs.push(created);
    await saveCronStore(store, home);
    return created;
}
export async function removeCronJob(id, home = homedir()) {
    const store = await loadCronStore(home);
    const before = store.jobs.length;
    store.jobs = store.jobs.filter((j) => j.id !== id);
    if (store.jobs.length === before)
        return false;
    await saveCronStore(store, home);
    return true;
}
export async function listCronJobs(home = homedir()) {
    return (await loadCronStore(home)).jobs;
}
// ── Cron expression matching ────────────────────────────────────────────
// 5 fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, 0=Sun).
// Each supports: *  a  a-b  a,b,c  */n  a-b/n
const FIELD_RANGES = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
];
/** Returns an error message if `expr` is not a valid 5-field cron, else null. */
export function validateCronExpr(expr) {
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5) {
        return `cron expression must have 5 fields (got ${fields.length}): "${expr}"`;
    }
    for (let i = 0; i < 5; i++) {
        try {
            matchField(fields[i], FIELD_RANGES[i][0], FIELD_RANGES[i][1], FIELD_RANGES[i][0]);
        }
        catch (err) {
            return `invalid cron field "${fields[i]}": ${err.message}`;
        }
    }
    return null;
}
/** Whether a single field matches `value` within [min,max]. Throws on bad syntax. */
function matchField(field, min, max, value) {
    return field.split(',').some((part) => {
        let step = 1;
        let range = part;
        const slash = part.indexOf('/');
        if (slash !== -1) {
            step = Number(part.slice(slash + 1));
            range = part.slice(0, slash);
            if (!Number.isInteger(step) || step <= 0)
                throw new Error(`bad step "${part}"`);
        }
        let lo = min;
        let hi = max;
        if (range !== '*') {
            const dash = range.indexOf('-');
            if (dash !== -1) {
                lo = Number(range.slice(0, dash));
                hi = Number(range.slice(dash + 1));
            }
            else {
                lo = hi = Number(range);
            }
            if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
                throw new Error(`out of range [${min}-${max}]`);
            }
        }
        if (value < lo || value > hi)
            return false;
        return (value - lo) % step === 0;
    });
}
/** Is `date` a firing time for `schedule`? (minute granularity.) */
export function isCronDue(schedule, date) {
    const fields = schedule.trim().split(/\s+/);
    if (fields.length !== 5)
        return false;
    const values = [
        date.getMinutes(),
        date.getHours(),
        date.getDate(),
        date.getMonth() + 1,
        date.getDay(),
    ];
    try {
        for (let i = 0; i < 5; i++) {
            if (!matchField(fields[i], FIELD_RANGES[i][0], FIELD_RANGES[i][1], values[i])) {
                return false;
            }
        }
    }
    catch {
        return false;
    }
    return true;
}
/**
 * Enabled jobs due to run at `now`.
 *
 * Synchronous and cron-only. Kept because it is the shape every existing caller
 * and test uses, and because a clock trigger needs nothing but the clock — but
 * a job with a non-cron trigger is not decidable here, so it is skipped rather
 * than guessed at. Use `dueJobsWithTriggers` to evaluate all of them.
 */
export function dueJobs(jobs, now) {
    return jobs.filter((j) => j.enabled && resolveTrigger(j).kind === 'cron' && isCronDue(j.schedule, now));
}
/**
 * Every enabled job whose trigger has fired, whatever kind it is.
 *
 * Async because a calendar has to be read and a watched file has to be stat'd.
 * Diagnostics ride along on the verdict so the scheduler can log "this
 * calendar has an RRULE I cannot express" next to the job it belongs to,
 * instead of on nobody's behalf.
 */
export async function dueJobsWithTriggers(jobs, now) {
    const out = [];
    for (const job of jobs) {
        if (!job.enabled)
            continue;
        const verdict = await isTriggerDue(resolveTrigger(job), { now, cwd: job.cwd, lastRunAt: job.lastRunAt }, isCronDue);
        if (verdict.due)
            out.push({ job, verdict });
    }
    return out;
}
export { describeTrigger, isTriggerDue, resolveTrigger, validateTrigger, } from './triggers.js';
export { matchingEvents, occursAt, parseIcs, } from './ics.js';
export { describeClamp, resolveTriggerMode, tightenPermissions, tightenSandbox, } from './profile.js';
//# sourceMappingURL=index.js.map