/** One expandable calendar entry. Times are UTC epoch milliseconds. */
export interface IcsEvent {
    summary: string;
    /** First occurrence. */
    startMs: number;
    /** Whole-day entries have no meaningful minute, and never match a minute. */
    allDay: boolean;
    recurrence?: IcsRecurrence;
}
export interface IcsRecurrence {
    freq: 'DAILY' | 'WEEKLY';
    interval: number;
    /** 0–6, Sunday first, matching `Date#getUTCDay`. Empty means "same as DTSTART". */
    byDay: number[];
    untilMs?: number;
    count?: number;
}
export interface IcsCalendar {
    events: IcsEvent[];
    /**
     * Things this parser saw and could not express.
     *
     * Surfaced rather than swallowed. An unsupported `RRULE` means the user's job
     * will not fire on the days they expect, and the only thing worse than not
     * supporting it is not supporting it quietly.
     */
    unsupported: string[];
}
export declare function parseIcs(text: string): IcsCalendar;
/**
 * Does any occurrence of `event` begin during the minute containing `atMs`?
 *
 * Minute granularity, matching cron: the scheduler wakes on a timer and asks
 * "what is due now", so a trigger that could only be observed to the second
 * would fire or not depending on how promptly launchd got around to it.
 *
 * All-day entries never match. They name a day, not a moment, and picking one
 * (midnight? 09:00?) would be this module inventing a schedule the user did not
 * write.
 */
export declare function occursAt(event: IcsEvent, atMs: number): boolean;
/** Events whose summary contains `match` (case-insensitive); all of them when absent. */
export declare function matchingEvents(calendar: IcsCalendar, match?: string): IcsEvent[];
//# sourceMappingURL=ics.d.ts.map