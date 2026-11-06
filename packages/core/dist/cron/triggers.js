// What makes a scheduled job fire.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §4 PR 8 — "触发源抽象（ICS / watch）"
//
// Until now the only answer was a clock: `cron` had a 5-field expression and
// nothing else. "Run the release checklist when the release meeting starts" and
// "re-run the generator when the schema changes" are both scheduling, and
// neither is a time.
//
// Every source is **polled**, not pushed. `deepcode scheduler run` already wakes
// on a timer and asks what is due; keeping that shape means no daemon, no
// watcher process, and no way for a trigger to fire while nothing is watching.
// It also means minute granularity for all of them, which is the granularity the
// user can actually observe.
import { promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { matchingEvents, occursAt, parseIcs } from './ics.js';
/**
 * The source a job uses.
 *
 * `trigger` wins when present; otherwise the legacy `schedule` string is the
 * source. Jobs written before this existed keep working untouched, and a job
 * file never has to be migrated.
 */
export function resolveTrigger(job) {
    if (job.trigger)
        return job.trigger;
    return { kind: 'cron', schedule: job.schedule ?? '' };
}
/** A one-line description for `cron list` and the job log. */
export function describeTrigger(source) {
    switch (source.kind) {
        case 'cron':
            return `cron ${source.schedule}`;
        case 'ics':
            return `calendar ${source.path}${source.match ? ` matching "${source.match}"` : ''}`;
        case 'file':
            return `changes to ${source.paths.join(', ')}`;
    }
}
async function defaultRead(path) {
    return fs.readFile(path, 'utf8');
}
async function defaultMtime(path) {
    try {
        return (await fs.stat(path)).mtimeMs;
    }
    catch {
        return null;
    }
}
export async function isTriggerDue(source, ctx, isCronDue) {
    if (source.kind === 'cron') {
        return { due: isCronDue(source.schedule, ctx.now) };
    }
    const at = (p) => (isAbsolute(p) ? p : resolve(ctx.cwd, p));
    if (source.kind === 'ics') {
        let calendar;
        try {
            calendar = parseIcs(await (ctx.readFile ?? defaultRead)(at(source.path)));
        }
        catch (error) {
            // An unreadable calendar is reported, not treated as "no events". The
            // difference matters: one is a job that will never fire and should be
            // fixed, the other is an ordinary quiet minute.
            return { due: false, reason: `calendar unreadable: ${error.message}` };
        }
        const events = matchingEvents(calendar, source.match);
        const hit = events.find((event) => occursAt(event, ctx.now.getTime()));
        return {
            due: hit !== undefined,
            ...(hit ? { reason: `calendar event "${hit.summary || '(untitled)'}" starts now` } : {}),
            ...(calendar.unsupported.length > 0 ? { diagnostics: calendar.unsupported } : {}),
        };
    }
    // file: fire when anything watched is newer than the last run.
    const since = ctx.lastRunAt ? Date.parse(ctx.lastRunAt) : Number.NaN;
    const stat = ctx.statMtimeMs ?? defaultMtime;
    if (!Number.isFinite(since)) {
        return {
            due: false,
            reason: 'first evaluation — recording a baseline rather than firing on files nobody touched',
        };
    }
    for (const path of source.paths) {
        const mtime = await stat(at(path));
        // A missing path is not a change. Reporting it every minute would bury the
        // one message that matters, and a watched file being absent is a normal
        // state — it may not have been generated yet.
        if (mtime !== null && mtime > since) {
            return { due: true, reason: `${path} changed` };
        }
    }
    return { due: false };
}
/** Structural validation for a trigger written by a user or a tool. */
export function validateTrigger(source) {
    switch (source.kind) {
        case 'cron':
            return source.schedule.trim() ? null : 'cron trigger needs a schedule';
        case 'ics':
            return source.path.trim() ? null : 'calendar trigger needs a path to an .ics file';
        case 'file':
            return source.paths.length > 0 ? null : 'file trigger needs at least one path';
        default:
            return `unknown trigger kind: ${source.kind}`;
    }
}
//# sourceMappingURL=triggers.js.map