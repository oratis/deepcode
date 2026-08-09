import { describe, expect, it } from 'vitest';
import {
  describeTrigger,
  isTriggerDue,
  resolveTrigger,
  validateTrigger,
  type TriggerSource,
} from './triggers.js';

const alwaysDue = () => true;
const neverDue = () => false;
const at = (iso: string): Date => new Date(iso);

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'SUMMARY:Release meeting',
  'DTSTART:20260810T090000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:Lunch',
  'DTSTART:20260810T120000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('resolveTrigger', () => {
  it('falls back to the legacy schedule field', () => {
    // Jobs written before triggers existed keep working with no migration —
    // a store nobody has to rewrite cannot be rewritten wrongly.
    expect(resolveTrigger({ schedule: '0 9 * * *' })).toEqual({
      kind: 'cron',
      schedule: '0 9 * * *',
    });
  });

  it('prefers an explicit trigger', () => {
    const trigger: TriggerSource = { kind: 'file', paths: ['schema.json'] };
    expect(resolveTrigger({ schedule: '0 9 * * *', trigger })).toBe(trigger);
  });
});

describe('isTriggerDue — cron', () => {
  it('delegates to the cron matcher', async () => {
    const source: TriggerSource = { kind: 'cron', schedule: '0 9 * * *' };
    const ctx = { now: at('2026-08-10T09:00:00Z'), cwd: '/work' };
    expect((await isTriggerDue(source, ctx, alwaysDue)).due).toBe(true);
    expect((await isTriggerDue(source, ctx, neverDue)).due).toBe(false);
  });
});

describe('isTriggerDue — ics', () => {
  const ctx = (iso: string, match?: string) => ({
    source: { kind: 'ics' as const, path: 'team.ics', ...(match ? { match } : {}) },
    ctx: { now: at(iso), cwd: '/work', readFile: async () => ICS },
  });

  it('fires in the minute an event starts', async () => {
    const { source, ctx: c } = ctx('2026-08-10T09:00:00Z');
    const verdict = await isTriggerDue(source, c, neverDue);
    expect(verdict.due).toBe(true);
    expect(verdict.reason).toMatch(/Release meeting/);
  });

  it('stays quiet in between', async () => {
    const { source, ctx: c } = ctx('2026-08-10T09:30:00Z');
    expect((await isTriggerDue(source, c, neverDue)).due).toBe(false);
  });

  it('follows the recurrence, not just the first occurrence', async () => {
    const { source, ctx: c } = ctx('2026-08-17T09:00:00Z'); // next Monday
    expect((await isTriggerDue(source, c, neverDue)).due).toBe(true);
  });

  it('filters by summary', async () => {
    const lunch = ctx('2026-08-10T09:00:00Z', 'lunch');
    expect((await isTriggerDue(lunch.source, lunch.ctx, neverDue)).due).toBe(false);
    const release = ctx('2026-08-10T09:00:00Z', 'release');
    expect((await isTriggerDue(release.source, release.ctx, neverDue)).due).toBe(true);
  });

  it('reports an unreadable calendar instead of reading it as empty', async () => {
    // "This job will never fire and should be fixed" and "an ordinary quiet
    // minute" must not look the same in the log.
    const verdict = await isTriggerDue(
      { kind: 'ics', path: 'missing.ics' },
      {
        now: at('2026-08-10T09:00:00Z'),
        cwd: '/work',
        readFile: async () => {
          throw new Error('ENOENT: no such file');
        },
      },
      neverDue,
    );
    expect(verdict.due).toBe(false);
    expect(verdict.reason).toMatch(/calendar unreadable.*ENOENT/);
  });

  it('carries calendar diagnostics through to the caller', async () => {
    const verdict = await isTriggerDue(
      { kind: 'ics', path: 'team.ics' },
      {
        now: at('2026-08-10T09:00:00Z'),
        cwd: '/work',
        readFile: async () =>
          [
            'BEGIN:VEVENT',
            'SUMMARY:Billing',
            'DTSTART:20260810T090000Z',
            'RRULE:FREQ=MONTHLY',
            'END:VEVENT',
          ].join('\r\n'),
      },
      neverDue,
    );
    expect(verdict.diagnostics?.join(' ')).toMatch(/FREQ=MONTHLY/);
  });
});

describe('isTriggerDue — file', () => {
  const source: TriggerSource = { kind: 'file', paths: ['schema.json', 'gen/config.yaml'] };
  const now = at('2026-08-10T09:00:00Z');

  it('records a baseline instead of firing on its first evaluation', async () => {
    // Otherwise every file trigger fires the moment it is created, on files
    // nobody has touched since anyone cared.
    const verdict = await isTriggerDue(
      source,
      { now, cwd: '/work', statMtimeMs: async () => Date.parse('2020-01-01T00:00:00Z') },
      neverDue,
    );
    expect(verdict.due).toBe(false);
    expect(verdict.reason).toMatch(/baseline/);
  });

  it('fires when a watched path is newer than the last run', async () => {
    const verdict = await isTriggerDue(
      source,
      {
        now,
        cwd: '/work',
        lastRunAt: '2026-08-10T08:00:00Z',
        statMtimeMs: async (p) =>
          p.endsWith('schema.json') ? Date.parse('2026-08-10T08:30:00Z') : null,
      },
      neverDue,
    );
    expect(verdict.due).toBe(true);
    expect(verdict.reason).toMatch(/schema\.json changed/);
  });

  it('stays quiet when nothing moved', async () => {
    const verdict = await isTriggerDue(
      source,
      {
        now,
        cwd: '/work',
        lastRunAt: '2026-08-10T08:00:00Z',
        statMtimeMs: async () => Date.parse('2026-08-10T07:00:00Z'),
      },
      neverDue,
    );
    expect(verdict.due).toBe(false);
  });

  it('treats a missing path as unchanged, not as an error every minute', async () => {
    // A watched file being absent is a normal state — it may not have been
    // generated yet. Reporting it each minute would bury the messages that
    // matter.
    const verdict = await isTriggerDue(
      source,
      { now, cwd: '/work', lastRunAt: '2026-08-10T08:00:00Z', statMtimeMs: async () => null },
      neverDue,
    );
    expect(verdict).toEqual({ due: false });
  });
});

describe('validateTrigger', () => {
  it('rejects a source that cannot fire', () => {
    expect(validateTrigger({ kind: 'cron', schedule: '  ' })).toMatch(/needs a schedule/);
    expect(validateTrigger({ kind: 'ics', path: '' })).toMatch(/\.ics/);
    expect(validateTrigger({ kind: 'file', paths: [] })).toMatch(/at least one path/);
  });

  it('accepts a usable one', () => {
    expect(validateTrigger({ kind: 'cron', schedule: '0 9 * * *' })).toBeNull();
    expect(validateTrigger({ kind: 'ics', path: 'team.ics' })).toBeNull();
    expect(validateTrigger({ kind: 'file', paths: ['a'] })).toBeNull();
  });
});

describe('describeTrigger', () => {
  it('says what will make the job run', () => {
    expect(describeTrigger({ kind: 'cron', schedule: '0 9 * * *' })).toBe('cron 0 9 * * *');
    expect(describeTrigger({ kind: 'ics', path: 't.ics', match: 'release' })).toBe(
      'calendar t.ics matching "release"',
    );
    expect(describeTrigger({ kind: 'file', paths: ['a', 'b'] })).toBe('changes to a, b');
  });
});
