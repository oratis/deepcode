import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BashTool } from './bash.js';

describe('BashTool', () => {
  let tmp: string;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dc-bash-'));
  });
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('runs a simple command and captures stdout', async () => {
    const r = await BashTool.execute({ command: 'echo hello-deepcode' }, { cwd: tmp });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('hello-deepcode');
    expect(r.content).toMatch(/exit: 0/);
    expect(r.data?.exitCode).toBe(0);
  });

  it('captures stderr separately', async () => {
    const r = await BashTool.execute({ command: 'echo nope >&2; exit 3' }, { cwd: tmp });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('nope');
    expect(r.content).toMatch(/exit: 3/);
  });

  it('respects timeout', async () => {
    const r = await BashTool.execute({ command: 'sleep 5', timeout: 200 }, { cwd: tmp });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/killed by timeout/i);
  }, 5000);

  it('rejects run_in_background (deferred to M3.15.3)', async () => {
    const r = await BashTool.execute({ command: 'true', run_in_background: true }, { cwd: tmp });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/M3\.15\.3/);
  });

  it('runs in the given cwd', async () => {
    const r = await BashTool.execute({ command: 'pwd' }, { cwd: tmp });
    // macOS resolves /private/var symlinks for /tmp paths; tolerate that
    expect(r.content).toMatch(
      new RegExp(tmp.replace(/^\/tmp/, '(/private)?/tmp').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')),
    );
  });
});
