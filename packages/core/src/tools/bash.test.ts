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

  it('run_in_background returns immediately with a log path that fills in', async () => {
    const r = await BashTool.execute(
      { command: 'echo bg-output-here', run_in_background: true },
      { cwd: tmp, sessionDir: tmp },
    );
    expect(r.isError).toBeFalsy();
    const logPath = (r.data as { logPath?: string }).logPath;
    expect(typeof logPath).toBe('string');
    expect(r.content).toContain(logPath!);
    // The process is detached; poll the log until the echo lands (or time out).
    const { readFile } = await import('node:fs/promises');
    let body = '';
    for (let i = 0; i < 50; i++) {
      body = await readFile(logPath!, 'utf8').catch(() => '');
      if (body.includes('bg-output-here')) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(body).toContain('bg-output-here');
    expect(body).toContain('$ echo bg-output-here'); // command header
  }, 5000);

  it('runs in the given cwd', async () => {
    const r = await BashTool.execute({ command: 'pwd' }, { cwd: tmp });
    // macOS resolves /tmp → /private/tmp via symlink. Check just the suffix to be portable.
    const suffix = tmp.replace(/^\/tmp\//, '').replace(/^\/private\/tmp\//, '');
    expect(r.content).toContain(suffix);
  });
});
