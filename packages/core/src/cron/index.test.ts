import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addCronJob,
  cronStorePath,
  dueJobs,
  isCronDue,
  listCronJobs,
  loadCronStore,
  removeCronJob,
  validateCronExpr,
} from './index.js';

describe('validateCronExpr', () => {
  it('accepts valid 5-field expressions', () => {
    expect(validateCronExpr('* * * * *')).toBeNull();
    expect(validateCronExpr('0 9 * * 1-5')).toBeNull();
    expect(validateCronExpr('*/15 0-6 1,15 */2 *')).toBeNull();
    expect(validateCronExpr('30 8 1 1 0')).toBeNull();
  });

  it('rejects wrong field count', () => {
    expect(validateCronExpr('* * * *')).toMatch(/5 fields/);
    expect(validateCronExpr('* * * * * *')).toMatch(/5 fields/);
    expect(validateCronExpr('')).toMatch(/5 fields/);
  });

  it('rejects out-of-range values', () => {
    expect(validateCronExpr('60 * * * *')).toMatch(/invalid cron field/); // minute max 59
    expect(validateCronExpr('* 24 * * *')).toMatch(/invalid cron field/); // hour max 23
    expect(validateCronExpr('* * 0 * *')).toMatch(/invalid cron field/); // dom min 1
    expect(validateCronExpr('* * * 13 *')).toMatch(/invalid cron field/); // month max 12
    expect(validateCronExpr('* * * * 7')).toMatch(/invalid cron field/); // dow max 6
  });

  it('rejects malformed steps and ranges', () => {
    expect(validateCronExpr('*/0 * * * *')).toMatch(/invalid cron field/);
    expect(validateCronExpr('5-2 * * * *')).toMatch(/invalid cron field/); // lo>hi
    expect(validateCronExpr('a * * * *')).toMatch(/invalid cron field/);
  });
});

describe('isCronDue', () => {
  // 2026-03-09 is a Monday (getDay()===1). 09:30 local.
  const monday0930 = new Date(2026, 2, 9, 9, 30, 0);

  it('matches wildcard', () => {
    expect(isCronDue('* * * * *', monday0930)).toBe(true);
  });

  it('matches exact minute+hour', () => {
    expect(isCronDue('30 9 * * *', monday0930)).toBe(true);
    expect(isCronDue('31 9 * * *', monday0930)).toBe(false);
    expect(isCronDue('30 10 * * *', monday0930)).toBe(false);
  });

  it('matches weekday ranges', () => {
    expect(isCronDue('30 9 * * 1-5', monday0930)).toBe(true); // Mon in 1-5
    expect(isCronDue('30 9 * * 6', monday0930)).toBe(false); // not Sat
    expect(isCronDue('30 9 * * 0', monday0930)).toBe(false); // not Sun
  });

  it('matches step values', () => {
    // minute 30 is divisible by 15 → */15 matches; 0,15,30,45
    expect(isCronDue('*/15 * * * *', monday0930)).toBe(true);
    expect(isCronDue('*/20 * * * *', new Date(2026, 2, 9, 9, 40, 0))).toBe(true);
    expect(isCronDue('*/20 * * * *', monday0930)).toBe(false); // 30 % 20 !== 0
  });

  it('matches comma lists', () => {
    expect(isCronDue('0,30 9 * * *', monday0930)).toBe(true);
    expect(isCronDue('0,15,45 9 * * *', monday0930)).toBe(false);
  });

  it('matches day-of-month + month', () => {
    expect(isCronDue('30 9 9 3 *', monday0930)).toBe(true); // 9th March
    expect(isCronDue('30 9 10 3 *', monday0930)).toBe(false);
    expect(isCronDue('30 9 9 4 *', monday0930)).toBe(false);
  });

  it('returns false on malformed schedule rather than throwing', () => {
    expect(isCronDue('not a cron', monday0930)).toBe(false);
    expect(isCronDue('* * * *', monday0930)).toBe(false);
  });
});

describe('dueJobs', () => {
  const monday0930 = new Date(2026, 2, 9, 9, 30, 0);
  it('returns only enabled + due jobs', () => {
    const jobs = [
      { id: 'a', schedule: '30 9 * * *', prompt: '', cwd: '/', createdAt: '', enabled: true },
      { id: 'b', schedule: '0 9 * * *', prompt: '', cwd: '/', createdAt: '', enabled: true },
      { id: 'c', schedule: '30 9 * * *', prompt: '', cwd: '/', createdAt: '', enabled: false },
    ];
    expect(dueJobs(jobs, monday0930).map((j) => j.id)).toEqual(['a']);
  });
});

describe('cron store CRUD', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-cron-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('cronStorePath is under ~/.deepcode', () => {
    expect(cronStorePath(home)).toBe(join(home, '.deepcode', 'cron.json'));
  });

  it('loads empty store when file is absent', async () => {
    expect(await loadCronStore(home)).toEqual({ jobs: [] });
  });

  it('adds, lists, and removes jobs', async () => {
    const job = await addCronJob(
      { schedule: '0 9 * * 1-5', prompt: 'standup', cwd: '/proj' },
      home,
    );
    expect(job.id).toMatch(/^cron-/);
    expect(job.enabled).toBe(true);
    expect(job.createdAt).not.toBe('');

    const list = await listCronJobs(home);
    expect(list).toHaveLength(1);
    expect(list[0]!.prompt).toBe('standup');

    expect(await removeCronJob(job.id, home)).toBe(true);
    expect(await listCronJobs(home)).toHaveLength(0);
    // second removal is a no-op
    expect(await removeCronJob(job.id, home)).toBe(false);
  });

  it('generates unique ids for rapid adds', async () => {
    const a = await addCronJob({ schedule: '* * * * *', prompt: 'a', cwd: '/' }, home);
    const b = await addCronJob({ schedule: '* * * * *', prompt: 'b', cwd: '/' }, home);
    expect(a.id).not.toBe(b.id);
    expect(await listCronJobs(home)).toHaveLength(2);
  });

  it('rejects invalid schedules', async () => {
    await expect(addCronJob({ schedule: 'bad', prompt: 'x', cwd: '/' }, home)).rejects.toThrow(
      /5 fields/,
    );
  });
});
