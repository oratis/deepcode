// A deliberately small iCalendar (RFC 5545) reader.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §4 PR 8 — "触发源抽象（ICS / watch）"
//
// Standard ICS text is the only calendar input DeepCode accepts. No vendor SDK,
// no OAuth to anybody's calendar service, no polling of a remote account: you
// point a job at a `.ics` file and DeepCode reads it. Every calendar worth
// integrating with can export one, and a file on disk is a boundary you can
// inspect — which a vendor client library is not.
//
// The parser is strict and small, for the same reason the file-contract parser
// is: a construct it does not recognise is reported, never dropped. A silently
// ignored `RRULE` is a scheduled job that never fires, and the failure looks
// exactly like "nothing was scheduled".

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

const DAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Undo RFC 5545 line folding.
 *
 * A continuation line begins with a space or tab and belongs to the previous
 * one. Calendars fold aggressively — a 90-character SUMMARY is routinely split —
 * so a parser that skips this step misreads ordinary files, not exotic ones.
 */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

/** `DTSTART;TZID=X:20260809T090000` → `{ name, params, value }`. */
function splitLine(line: string): { name: string; params: string[]; value: string } | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const [name, ...params] = line.slice(0, colon).split(';');
  return { name: (name ?? '').toUpperCase(), params, value: line.slice(colon + 1) };
}

/**
 * Parse an ICS timestamp.
 *
 * Handles UTC (`…Z`), date-only (`VALUE=DATE`), and floating local times. A
 * floating time is read as UTC rather than guessed at: DeepCode has no way to
 * know the calendar's zone, and quietly applying the host's would make the same
 * file fire at different moments on different machines. `TZID` is reported as
 * unsupported for the same reason.
 */
function parseStamp(value: string): { ms: number; allDay: boolean } | null {
  const date = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!date) return null;
  const [, y, mo, d, h, mi, s] = date;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h ?? '0'),
    Number(mi ?? '0'),
    Number(s ?? '0'),
  );
  return { ms, allDay: h === undefined };
}

function parseRecurrence(value: string, unsupported: string[]): IcsRecurrence | undefined {
  const parts = new Map<string, string>();
  for (const chunk of value.split(';')) {
    const eq = chunk.indexOf('=');
    if (eq > 0) parts.set(chunk.slice(0, eq).toUpperCase(), chunk.slice(eq + 1));
  }

  const freq = (parts.get('FREQ') ?? '').toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY') {
    // MONTHLY and YEARLY need month-length and leap-year rules that are easy to
    // get subtly wrong, and a scheduler that fires on the wrong day is worse
    // than one that says it cannot.
    unsupported.push(`RRULE FREQ=${freq || '(missing)'} is not supported (only DAILY and WEEKLY)`);
    return undefined;
  }
  for (const key of ['BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'BYWEEKNO', 'BYYEARDAY']) {
    if (parts.has(key)) unsupported.push(`RRULE ${key} is not supported`);
  }

  const byDay: number[] = [];
  for (const token of (parts.get('BYDAY') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)) {
    // `2MO` (second Monday) carries an ordinal this parser does not implement.
    const day = DAYS[token.toUpperCase()];
    if (day === undefined) unsupported.push(`RRULE BYDAY=${token} is not supported`);
    else byDay.push(day);
  }

  const until = parts.get('UNTIL') ? parseStamp(parts.get('UNTIL')!) : null;
  const count = parts.get('COUNT') ? Number(parts.get('COUNT')) : undefined;
  return {
    freq,
    interval: Math.max(1, Number(parts.get('INTERVAL') ?? '1') || 1),
    byDay,
    ...(until ? { untilMs: until.ms } : {}),
    ...(Number.isFinite(count) && count ? { count } : {}),
  };
}

export function parseIcs(text: string): IcsCalendar {
  const events: IcsEvent[] = [];
  const unsupported: string[] = [];
  let current: Partial<IcsEvent> | null = null;

  for (const line of unfold(text)) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (current && typeof current.startMs === 'number') {
        events.push({
          summary: current.summary ?? '',
          startMs: current.startMs,
          allDay: current.allDay ?? false,
          ...(current.recurrence ? { recurrence: current.recurrence } : {}),
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const field = splitLine(trimmed);
    if (!field) continue;
    if (field.name === 'SUMMARY') {
      // Unescape the four sequences RFC 5545 defines. Left as-is otherwise:
      // a SUMMARY is matched against, not executed.
      current.summary = field.value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
      continue;
    }
    if (field.name === 'DTSTART') {
      if (field.params.some((p) => p.toUpperCase().startsWith('TZID='))) {
        unsupported.push(
          `DTSTART with TZID is read as UTC — DeepCode does not carry a timezone database`,
        );
      }
      const stamp = parseStamp(field.value);
      if (stamp) {
        current.startMs = stamp.ms;
        current.allDay = stamp.allDay;
      }
      continue;
    }
    if (field.name === 'RRULE') {
      current.recurrence = parseRecurrence(field.value, unsupported);
    }
  }

  return { events, unsupported: [...new Set(unsupported)] };
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

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
export function occursAt(event: IcsEvent, atMs: number): boolean {
  if (event.allDay) return false;
  const minuteStart = Math.floor(atMs / MINUTE) * MINUTE;
  if (event.startMs === minuteStart) return true;

  const rule = event.recurrence;
  if (!rule) return false;
  if (minuteStart < event.startMs) return false;
  if (rule.untilMs !== undefined && minuteStart > rule.untilMs) return false;

  // The time of day has to match the original; recurrence repeats the day, not
  // the clock.
  const timeOfDay = (ms: number): number => ms - Math.floor(ms / DAY) * DAY;
  if (timeOfDay(minuteStart) !== timeOfDay(event.startMs)) return false;

  const daysApart = Math.round((minuteStart - event.startMs) / DAY);

  if (rule.freq === 'DAILY') {
    if (daysApart % rule.interval !== 0) return false;
    return withinCount(rule, Math.floor(daysApart / rule.interval));
  }

  // WEEKLY: the candidate must fall on a listed weekday, in an active week.
  const weekday = new Date(minuteStart).getUTCDay();
  const days = rule.byDay.length > 0 ? rule.byDay : [new Date(event.startMs).getUTCDay()];
  if (!days.includes(weekday)) return false;
  const weeksApart = Math.floor(
    (startOfWeek(minuteStart) - startOfWeek(event.startMs)) / (7 * DAY),
  );
  if (weeksApart % rule.interval !== 0) return false;
  // COUNT counts occurrences, and a weekly rule with three BYDAY entries
  // produces three per active week — not one.
  return withinCount(rule, Math.floor(weeksApart / rule.interval) * days.length);
}

function startOfWeek(ms: number): number {
  const day = new Date(ms).getUTCDay();
  return Math.floor(ms / DAY) * DAY - day * DAY;
}

function withinCount(rule: IcsRecurrence, index: number): boolean {
  return rule.count === undefined || index < rule.count;
}

/** Events whose summary contains `match` (case-insensitive); all of them when absent. */
export function matchingEvents(calendar: IcsCalendar, match?: string): IcsEvent[] {
  if (!match) return calendar.events;
  const needle = match.toLowerCase();
  return calendar.events.filter((event) => event.summary.toLowerCase().includes(needle));
}
