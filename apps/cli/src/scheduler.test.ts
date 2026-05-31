import { addCronJob, launchdPlistPath } from '@deepcode/core';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCronCommand, runSchedulerRun } from './scheduler.js';

/** Writable that collects everything into a string. */
function sink(): { stream: Writable; text: () => string } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => buf };
}

describe('runSchedulerRun', () => {
  let home: string;
  // 2026-03-09 09:30 local is a Monday.
  const monday0930 = new Date(2026, 2, 9, 9, 30, 0);

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-sched-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('runs only the due jobs and records lastRunAt', async () => {
    const due = await addCronJob({ schedule: '30 9 * * *', prompt: 'due', cwd: '/p' }, home);
    await addCronJob({ schedule: '0 0 * * *', prompt: 'not due', cwd: '/p' }, home);

    const ranIds: string[] = [];
    const out = sink();
    const result = await runSchedulerRun({
      now: monday0930,
      home,
      output: out.stream,
      runJob: async (j) => {
        ranIds.push(j.id);
      },
    });

    expect(result.ran).toEqual([due.id]);
    expect(ranIds).toEqual([due.id]);
    expect(out.text()).toContain('1 job(s) due');

    // lastRunAt persisted for the job that ran, absent for the other.
    const raw = JSON.parse(await fs.readFile(join(home, '.deepcode', 'cron.json'), 'utf8'));
    const ran = raw.jobs.find((j: { id: string }) => j.id === due.id);
    expect(ran.lastRunAt).toBe(monday0930.toISOString());
    const skipped = raw.jobs.find((j: { prompt: string }) => j.prompt === 'not due');
    expect(skipped.lastRunAt).toBeUndefined();
  });

  it('no-ops when nothing is due', async () => {
    await addCronJob({ schedule: '0 0 * * *', prompt: 'nightly', cwd: '/p' }, home);
    const out = sink();
    const result = await runSchedulerRun({ now: monday0930, home, output: out.stream });
    expect(result.ran).toEqual([]);
    expect(out.text()).toBe('');
  });

  it('continues past a failing job and still records the others', async () => {
    const bad = await addCronJob({ schedule: '30 9 * * *', prompt: 'boom', cwd: '/p' }, home);
    const good = await addCronJob({ schedule: '30 9 * * *', prompt: 'ok', cwd: '/p' }, home);
    const out = sink();
    const result = await runSchedulerRun({
      now: monday0930,
      home,
      output: out.stream,
      runJob: async (j) => {
        if (j.id === bad.id) throw new Error('kaboom');
      },
    });
    expect(result.ran).toEqual([good.id]);
    expect(out.text()).toContain('kaboom');
  });
});

describe('runCronCommand', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-cron-cli-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('list reports an empty store', async () => {
    const out = sink();
    const code = await runCronCommand(['list'], { home, output: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toMatch(/No scheduled jobs/);
  });

  it('list shows created jobs', async () => {
    await addCronJob({ schedule: '0 9 * * 1-5', prompt: 'standup report', cwd: '/proj' }, home);
    const out = sink();
    await runCronCommand(['list'], { home, output: out.stream });
    expect(out.text()).toContain('0 9 * * 1-5');
    expect(out.text()).toContain('standup report');
    expect(out.text()).toContain('/proj');
  });

  it('install writes a plist with verbatim node+script program args', async () => {
    const out = sink();
    const code = await runCronCommand(['install'], {
      home,
      output: out.stream,
      skipLaunchctl: true,
      argv: ['/usr/bin/node', '/opt/deepcode/cli.js'],
    });
    expect(code).toBe(0);
    const xml = await fs.readFile(launchdPlistPath(home), 'utf8');
    expect(xml).toContain('<string>/usr/bin/node</string>');
    expect(xml).toContain('<string>/opt/deepcode/cli.js</string>');
    expect(xml).toContain('<string>scheduler</string>');
    expect(xml).toContain('<string>run</string>');
  });

  it('status reports installed=false then true', async () => {
    const before = sink();
    await runCronCommand(['status'], { home, output: before.stream });
    expect(before.text()).toMatch(/NOT installed/);

    await runCronCommand(['install'], {
      home,
      output: sink().stream,
      skipLaunchctl: true,
      argv: ['/usr/bin/node', '/opt/deepcode/cli.js'],
    });

    const after = sink();
    await runCronCommand(['status'], { home, output: after.stream });
    expect(after.text()).toMatch(/installed \(/);
  });

  it('uninstall removes the plist', async () => {
    await runCronCommand(['install'], {
      home,
      output: sink().stream,
      skipLaunchctl: true,
      argv: ['/usr/bin/node', '/opt/deepcode/cli.js'],
    });
    const out = sink();
    const code = await runCronCommand(['uninstall'], {
      home,
      output: out.stream,
      skipLaunchctl: true,
    });
    expect(code).toBe(0);
    expect(out.text()).toMatch(/Removed LaunchAgent/);
    await expect(fs.access(launchdPlistPath(home))).rejects.toThrow();
  });

  it('unknown subcommand prints help and returns 2', async () => {
    const out = sink();
    const code = await runCronCommand(['frobnicate'], { home, output: out.stream });
    expect(code).toBe(2);
    expect(out.text()).toMatch(/Usage: deepcode cron/);
  });

  it('no subcommand prints help and returns 0', async () => {
    const out = sink();
    const code = await runCronCommand([], { home, output: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toMatch(/Usage: deepcode cron/);
  });
});
