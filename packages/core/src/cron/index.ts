// Cron — scheduled agent tasks. Stores jobs in ~/.deepcode/cron.json and matches
// 5-field cron expressions. The CronCreate/CronList/CronDelete tools CRUD the
// store; a separate `deepcode scheduler run` (CLI) executes due jobs.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.4 / §0.1 (CronCreate family)

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CronJob {
  id: string;
  /** 5-field cron expression: "min hour day-of-month month day-of-week". */
  schedule: string;
  /** Prompt to run headlessly when the job fires. */
  prompt: string;
  /** Working directory to run in. */
  cwd: string;
  createdAt: string;
  lastRunAt?: string;
  enabled: boolean;
}

export interface CronStore {
  jobs: CronJob[];
}

export function cronStorePath(home: string = homedir()): string {
  return join(home, '.deepcode', 'cron.json');
}

export async function loadCronStore(home: string = homedir()): Promise<CronStore> {
  try {
    const raw = await fs.readFile(cronStorePath(home), 'utf8');
    const parsed = JSON.parse(raw) as CronStore;
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { jobs: [] };
    throw err;
  }
}

export async function saveCronStore(store: CronStore, home: string = homedir()): Promise<void> {
  const path = cronStorePath(home);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

let cronSeq = 0;
function newCronId(): string {
  return `cron-${Date.now().toString(36)}-${(cronSeq++).toString(36)}`;
}

export async function addCronJob(
  job: { schedule: string; prompt: string; cwd: string },
  home: string = homedir(),
): Promise<CronJob> {
  const invalid = validateCronExpr(job.schedule);
  if (invalid) throw new Error(invalid);
  const store = await loadCronStore(home);
  const created: CronJob = {
    id: newCronId(),
    schedule: job.schedule.trim(),
    prompt: job.prompt,
    cwd: job.cwd,
    createdAt: new Date().toISOString(),
    enabled: true,
  };
  store.jobs.push(created);
  await saveCronStore(store, home);
  return created;
}

export async function removeCronJob(id: string, home: string = homedir()): Promise<boolean> {
  const store = await loadCronStore(home);
  const before = store.jobs.length;
  store.jobs = store.jobs.filter((j) => j.id !== id);
  if (store.jobs.length === before) return false;
  await saveCronStore(store, home);
  return true;
}

export async function listCronJobs(home: string = homedir()): Promise<CronJob[]> {
  return (await loadCronStore(home)).jobs;
}

// ── Cron expression matching ────────────────────────────────────────────
// 5 fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, 0=Sun).
// Each supports: *  a  a-b  a,b,c  */n  a-b/n

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
];

/** Returns an error message if `expr` is not a valid 5-field cron, else null. */
export function validateCronExpr(expr: string): string | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return `cron expression must have 5 fields (got ${fields.length}): "${expr}"`;
  }
  for (let i = 0; i < 5; i++) {
    try {
      matchField(fields[i]!, FIELD_RANGES[i]![0], FIELD_RANGES[i]![1], FIELD_RANGES[i]![0]);
    } catch (err) {
      return `invalid cron field "${fields[i]}": ${(err as Error).message}`;
    }
  }
  return null;
}

/** Whether a single field matches `value` within [min,max]. Throws on bad syntax. */
function matchField(field: string, min: number, max: number, value: number): boolean {
  return field.split(',').some((part) => {
    let step = 1;
    let range = part;
    const slash = part.indexOf('/');
    if (slash !== -1) {
      step = Number(part.slice(slash + 1));
      range = part.slice(0, slash);
      if (!Number.isInteger(step) || step <= 0) throw new Error(`bad step "${part}"`);
    }
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const dash = range.indexOf('-');
      if (dash !== -1) {
        lo = Number(range.slice(0, dash));
        hi = Number(range.slice(dash + 1));
      } else {
        lo = hi = Number(range);
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
        throw new Error(`out of range [${min}-${max}]`);
      }
    }
    if (value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  });
}

/** Is `date` a firing time for `schedule`? (minute granularity.) */
export function isCronDue(schedule: string, date: Date): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];
  try {
    for (let i = 0; i < 5; i++) {
      if (!matchField(fields[i]!, FIELD_RANGES[i]![0], FIELD_RANGES[i]![1], values[i]!)) {
        return false;
      }
    }
  } catch {
    return false;
  }
  return true;
}

/** Enabled jobs due to run at `now`. */
export function dueJobs(jobs: CronJob[], now: Date): CronJob[] {
  return jobs.filter((j) => j.enabled && isCronDue(j.schedule, now));
}
