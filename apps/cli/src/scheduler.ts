// `deepcode scheduler run` + `deepcode cron <install|uninstall|list|status>`
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 / §0.1
//
// The scheduler is fired once a minute by a launchd LaunchAgent (macOS). On each
// tick it loads ~/.deepcode/cron.json, finds jobs due *this minute*, and runs
// each one headlessly in its own project dir, appending output to a per-job log.
//
// `cron install` writes the LaunchAgent plist (pointing at THIS node + cli entry,
// so it survives `nvm`/path quirks) and best-effort `launchctl load`s it.

import {
  dueJobs,
  installPlist,
  launchdPlistPath,
  listCronJobs,
  loadCronStore,
  saveCronStore,
  uninstallPlist,
  type CronJob,
} from '@deepcode/core';
import { execFile } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Writable } from 'node:stream';
import { runHeadless } from './headless.js';

const execFileAsync = promisify(execFile);

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
export async function runSchedulerRun(deps: SchedulerDeps = {}): Promise<{ ran: string[] }> {
  const now = deps.now ?? new Date();
  const home = deps.home ?? homedir();
  const out = deps.output ?? process.stdout;
  const store = await loadCronStore(home);
  const due = dueJobs(store.jobs, now);
  const ran: string[] = [];
  if (due.length === 0) return { ran };

  out.write(`[scheduler] ${now.toISOString()} — ${due.length} job(s) due\n`);
  for (const job of due) {
    try {
      await (deps.runJob ?? ((j) => defaultRunJob(j, home)))(job);
      job.lastRunAt = now.toISOString();
      ran.push(job.id);
      out.write(`[scheduler] ran ${job.id}\n`);
    } catch (err) {
      out.write(`[scheduler] job ${job.id} failed: ${(err as Error).message}\n`);
    }
  }
  // Persist lastRunAt updates (the in-memory jobs are the same objects in store).
  await saveCronStore(store, home);
  return { ran };
}

/** Default execution: run the prompt headlessly in the job's cwd, logging to a file. */
async function defaultRunJob(job: CronJob, home: string): Promise<void> {
  const logPath = join(home, '.deepcode', 'cron-logs', `${job.id}.log`);
  await fs.mkdir(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: 'a' });
  try {
    log.write(`\n===== ${new Date().toISOString()} =====\n`);
    await runHeadless({
      output: log,
      errOutput: log,
      cwd: job.cwd,
      home,
      prompt: job.prompt,
      outputFormat: 'text',
    });
  } finally {
    log.end();
  }
}

// ── `deepcode cron <subcommand>` ────────────────────────────────────────

export interface CronCliDeps {
  home?: string;
  output?: Writable;
  errOutput?: Writable;
  /** Skip the `launchctl load/unload` side effect (tests). */
  skipLaunchctl?: boolean;
  /** The argv used to launch this process — [execPath, scriptPath, ...]. */
  argv?: string[];
}

export async function runCronCommand(sub: string[], deps: CronCliDeps = {}): Promise<number> {
  const home = deps.home ?? homedir();
  const out = deps.output ?? process.stdout;
  const err = deps.errOutput ?? process.stderr;
  const cmd = sub[0];

  switch (cmd) {
    case 'install':
      return cronInstall(home, out, err, deps);
    case 'uninstall':
      return cronUninstall(home, out, deps);
    case 'list':
      return cronList(home, out);
    case 'status':
      return cronStatus(home, out);
    default:
      out.write(cronHelp());
      return cmd ? 2 : 0;
  }
}

async function cronInstall(
  home: string,
  out: Writable,
  err: Writable,
  deps: CronCliDeps,
): Promise<number> {
  const argv = deps.argv ?? process.argv;
  const node = argv[0] ?? process.execPath;
  const script = argv[1] ?? '';
  if (!script) {
    err.write('cron install: could not determine the deepcode entry script.\n');
    return 1;
  }
  // Embed the absolute node + cli.js so the agent runs even outside a login shell.
  const programArgs = [node, script, 'scheduler', 'run'];
  const path = await installPlist({ home, binPath: node, programArgs, intervalSec: 60 });
  out.write(`Wrote LaunchAgent: ${path}\n`);

  if (!deps.skipLaunchctl && process.platform === 'darwin') {
    try {
      // Reload: unload first (ignore failure), then load -w to enable at login.
      await execFileAsync('launchctl', ['unload', path]).catch(() => undefined);
      await execFileAsync('launchctl', ['load', '-w', path]);
      out.write('Loaded into launchd (fires every 60s).\n');
    } catch (e) {
      out.write(`Wrote plist but launchctl load failed: ${(e as Error).message}\n`);
      out.write(`Load it manually: launchctl load -w "${path}"\n`);
    }
  } else if (process.platform !== 'darwin') {
    out.write('Note: automatic scheduling is macOS-only. On Linux, add a cron entry:\n');
    out.write(`  * * * * * "${node}" "${script}" scheduler run\n`);
  }
  return 0;
}

async function cronUninstall(home: string, out: Writable, deps: CronCliDeps): Promise<number> {
  const path = launchdPlistPath(home);
  if (!deps.skipLaunchctl && process.platform === 'darwin') {
    await execFileAsync('launchctl', ['unload', path]).catch(() => undefined);
  }
  const removed = await uninstallPlist(home);
  out.write(removed ? `Removed LaunchAgent: ${path}\n` : 'No LaunchAgent was installed.\n');
  return 0;
}

async function cronList(home: string, out: Writable): Promise<number> {
  const jobs = await listCronJobs(home);
  if (jobs.length === 0) {
    out.write('No scheduled jobs. Create one with the CronCreate tool in a session.\n');
    return 0;
  }
  for (const j of jobs) {
    out.write(
      `${j.id}  [${j.schedule}]${j.enabled ? '' : ' (disabled)'}  ${j.cwd}\n` +
        `    ${j.prompt.slice(0, 100)}\n` +
        (j.lastRunAt ? `    last run: ${j.lastRunAt}\n` : ''),
    );
  }
  return 0;
}

async function cronStatus(home: string, out: Writable): Promise<number> {
  const path = launchdPlistPath(home);
  const installed = await fs
    .access(path)
    .then(() => true)
    .catch(() => false);
  const jobs = await listCronJobs(home);
  out.write(
    `Scheduler: ${installed ? `installed (${path})` : 'NOT installed — run `deepcode cron install`'}\n`,
  );
  out.write(`Jobs: ${jobs.length} (${jobs.filter((j) => j.enabled).length} enabled)\n`);
  return 0;
}

function cronHelp(): string {
  return [
    'Usage: deepcode cron <command>',
    '',
    '  install     Install the launchd scheduler (fires every 60s)',
    '  uninstall   Remove the launchd scheduler',
    '  list        List scheduled jobs',
    '  status      Show scheduler + job status',
    '',
    'Create/delete jobs from inside a session with the CronCreate / CronDelete tools.',
    '',
  ].join('\n');
}
