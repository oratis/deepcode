import { describe, expect, it } from 'vitest';
import { matchingEvents, occursAt, parseIcs } from './ics.js';

const at = (iso: string): number => Date.parse(iso);

function calendar(body: string): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', body, 'END:VCALENDAR'].join('\r\n');
}

describe('parseIcs', () => {
  it('reads a plain UTC event', () => {
    const { events } = parseIcs(
      calendar(
        ['BEGIN:VEVENT', 'SUMMARY:Release meeting', 'DTSTART:20260810T090000Z', 'END:VEVENT'].join(
          '\r\n',
        ),
      ),
    );
    expect(events).toEqual([
      { summary: 'Release meeting', startMs: at('2026-08-10T09:00:00Z'), allDay: false },
    ]);
  });

  it('unfolds continuation lines', () => {
    // Calendars fold at 75 octets, so a normal-length SUMMARY arrives split. A
    // parser that skips this misreads ordinary files, not exotic ones.
    const { events } = parseIcs(
      calendar(
        [
          'BEGIN:VEVENT',
          'SUMMARY:Weekly release review with the',
          '  whole team',
          'DTSTART:20260810T090000Z',
          'END:VEVENT',
        ].join('\r\n'),
      ),
    );
    expect(events[0]!.summary).toBe('Weekly release review with the whole team');
  });

  it('unescapes the sequences RFC 5545 defines', () => {
    const { events } = parseIcs(
      calendar(
        [
          'BEGIN:VEVENT',
          'SUMMARY:Ship\\, then\\; rest',
          'DTSTART:20260810T090000Z',
          'END:VEVENT',
        ].join('\r\n'),
      ),
    );
    expect(events[0]!.summary).toBe('Ship, then; rest');
  });

  it('marks a date-only event as all-day', () => {
    const { events } = parseIcs(
      calendar(
        ['BEGIN:VEVENT', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20260810', 'END:VEVENT'].join(
          '\r\n',
        ),
      ),
    );
    expect(events[0]!.allDay).toBe(true);
  });

  it('reports a TZID rather than guessing a zone', () => {
    // Applying the host's zone would make the same file fire at different
    // moments on different machines.
    const { unsupported } = parseIcs(
      calendar(
        [
          'BEGIN:VEVENT',
          'SUMMARY:Standup',
          'DTSTART;TZID=Europe/Berlin:20260810T090000',
          'END:VEVENT',
        ].join('\r\n'),
      ),
    );
    expect(unsupported.join(' ')).toMatch(/TZID/);
  });

  it('reports recurrence rules it cannot express, rather than dropping them', () => {
    // A silently ignored RRULE is a job that never fires, and the failure looks
    // exactly like "nothing was scheduled".
    const { unsupported } = parseIcs(
      calendar(
        [
          'BEGIN:VEVENT',
          'SUMMARY:Monthly billing',
          'DTSTART:20260810T090000Z',
          'RRULE:FREQ=MONTHLY;BYMONTHDAY=10',
          'END:VEVENT',
        ].join('\r\n'),
      ),
    );
    expect(unsupported.join(' ')).toMatch(/FREQ=MONTHLY/);
  });

  it('reports an ordinal BYDAY it cannot express', () => {
    const { unsupported } = parseIcs(
      calendar(
        [
          'BEGIN:VEVENT',
          'DTSTART:20260810T090000Z',
          'RRULE:FREQ=WEEKLY;BYDAY=2MO',
          'END:VEVENT',
        ].join('\r\n'),
      ),
    );
    expect(unsupported.join(' ')).toMatch(/BYDAY=2MO/);
  });

  it('skips an event with no DTSTART instead of inventing one', () => {
    const { events } = parseIcs(
      calendar(['BEGIN:VEVENT', 'SUMMARY:Undated', 'END:VEVENT'].join('\r\n')),
    );
    expect(events).toEqual([]);
  });
});

describe('occursAt', () => {
  const base = { summary: 'Standup', startMs: at('2026-08-10T09:00:00Z'), allDay: false };

  it('matches the minute the event starts', () => {
    expect(occursAt(base, at('2026-08-10T09:00:00Z'))).toBe(true);
    expect(occursAt(base, at('2026-08-10T09:00:59Z'))).toBe(true); // same minute
    expect(occursAt(base, at('2026-08-10T09:01:00Z'))).toBe(false);
  });

  it('never matches an all-day entry', () => {
    // It names a day, not a moment. Picking one would be inventing a schedule
    // the user did not write.
    expect(occursAt({ ...base, allDay: true }, at('2026-08-10T00:00:00Z'))).toBe(false);
    expect(occursAt({ ...base, allDay: true }, at('2026-08-10T09:00:00Z'))).toBe(false);
  });

  it('does not match before the first occurrence', () => {
    const daily = { ...base, recurrence: { freq: 'DAILY' as const, interval: 1, byDay: [] } };
    expect(occursAt(daily, at('2026-08-09T09:00:00Z'))).toBe(false);
  });

  describe('DAILY', () => {
    const daily = { ...base, recurrence: { freq: 'DAILY' as const, interval: 1, byDay: [] } };

    it('repeats every day at the same time', () => {
      expect(occursAt(daily, at('2026-08-11T09:00:00Z'))).toBe(true);
      expect(occursAt(daily, at('2026-09-01T09:00:00Z'))).toBe(true);
    });

    it('keeps the time of day — recurrence repeats the day, not the clock', () => {
      expect(occursAt(daily, at('2026-08-11T10:00:00Z'))).toBe(false);
    });

    it('honours INTERVAL', () => {
      const everyThird = { ...base, recurrence: { ...daily.recurrence, interval: 3 } };
      expect(occursAt(everyThird, at('2026-08-13T09:00:00Z'))).toBe(true);
      expect(occursAt(everyThird, at('2026-08-12T09:00:00Z'))).toBe(false);
    });

    it('stops at UNTIL', () => {
      const bounded = {
        ...base,
        recurrence: { ...daily.recurrence, untilMs: at('2026-08-12T09:00:00Z') },
      };
      expect(occursAt(bounded, at('2026-08-12T09:00:00Z'))).toBe(true);
      expect(occursAt(bounded, at('2026-08-13T09:00:00Z'))).toBe(false);
    });

    it('stops after COUNT occurrences, counting the first', () => {
      const thrice = { ...base, recurrence: { ...daily.recurrence, count: 3 } };
      expect(occursAt(thrice, at('2026-08-10T09:00:00Z'))).toBe(true);
      expect(occursAt(thrice, at('2026-08-12T09:00:00Z'))).toBe(true);
      expect(occursAt(thrice, at('2026-08-13T09:00:00Z'))).toBe(false);
    });
  });

  describe('WEEKLY', () => {
    // 2026-08-10 is a Monday.
    const weekly = {
      ...base,
      recurrence: { freq: 'WEEKLY' as const, interval: 1, byDay: [] },
    };

    it('repeats on the start weekday when BYDAY is absent', () => {
      expect(occursAt(weekly, at('2026-08-17T09:00:00Z'))).toBe(true);
      expect(occursAt(weekly, at('2026-08-18T09:00:00Z'))).toBe(false);
    });

    it('fires on every listed weekday', () => {
      const mwf = { ...base, recurrence: { ...weekly.recurrence, byDay: [1, 3, 5] } };
      expect(occursAt(mwf, at('2026-08-12T09:00:00Z'))).toBe(true); // Wednesday
      expect(occursAt(mwf, at('2026-08-14T09:00:00Z'))).toBe(true); // Friday
      expect(occursAt(mwf, at('2026-08-13T09:00:00Z'))).toBe(false); // Thursday
    });

    it('honours INTERVAL by week, not by day', () => {
      const fortnightly = { ...base, recurrence: { ...weekly.recurrence, interval: 2 } };
      expect(occursAt(fortnightly, at('2026-08-24T09:00:00Z'))).toBe(true);
      expect(occursAt(fortnightly, at('2026-08-17T09:00:00Z'))).toBe(false);
    });
  });
});

describe('matchingEvents', () => {
  const cal = parseIcs(
    calendar(
      [
        'BEGIN:VEVENT',
        'SUMMARY:Release meeting',
        'DTSTART:20260810T090000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:Lunch',
        'DTSTART:20260810T120000Z',
        'END:VEVENT',
      ].join('\r\n'),
    ),
  );

  it('returns everything with no filter', () => {
    expect(matchingEvents(cal)).toHaveLength(2);
  });

  it('filters by substring, case-insensitively', () => {
    expect(matchingEvents(cal, 'release').map((e) => e.summary)).toEqual(['Release meeting']);
  });
});
