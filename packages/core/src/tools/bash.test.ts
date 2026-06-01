import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NetworkSandboxUnavailable } from '../sandbox/index.js';
import type { NetworkSandboxHandle } from '../sandbox/index.js';
import { BashTool } from './bash.js';

// A fake network-sandbox handle: stdout emits `text` then ends; `exited`
// resolves with `code` once stdout drains (so output is captured first).
function fakeNetHandle(text: string, code: number): NetworkSandboxHandle {
  const stdout = Readable.from([Buffer.from(text)]);
  const stderr = Readable.from([]);
  const child = { stdout, stderr } as unknown as ChildProcess;
  const exited = new Promise<number | null>((res) => stdout.once('end', () => res(code)));
  return { child, exited, close: async () => {} };
}

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

  // ── selective network allowlist wiring (M3.5-ext) ────────────────────────
  // platform + spawner are injected so these run on any OS without real bwrap.
  const allowlistCtx = (extra: Record<string, unknown>) => ({
    cwd: tmp,
    sandboxConfig: { enabled: true, network: { allowedDomains: ['example.com'] } },
    sandboxPlatform: 'linux',
    ...extra,
  });

  it('routes a non-empty allowlist through the network sandbox', async () => {
    let called = false;
    const r = await BashTool.execute(
      { command: 'echo ignored-by-fake' },
      allowlistCtx({
        sandboxNetSpawn: async () => {
          called = true;
          return fakeNetHandle('net-sandbox-ran\n', 0);
        },
      }) as never,
    );
    expect(called).toBe(true);
    expect(r.content).toContain('net-sandbox-ran');
    expect(r.data?.exitCode).toBe(0);
    expect(r.isError).toBeFalsy();
  });

  it('fails closed to deny-all-net when the network sandbox is unavailable', async () => {
    const r = await BashTool.execute(
      { command: 'echo fallback-ran' },
      allowlistCtx({
        sandboxNetSpawn: async () => {
          throw new NetworkSandboxUnavailable('cannot bind DNS proxy on 127.0.0.1:53');
        },
      }) as never,
    );
    // The fail-closed note is surfaced, and the command still ran (reached the
    // close handler via the deny-all-net fallback wrap).
    expect(r.content).toContain('network allowlist unavailable');
    expect(r.content).toMatch(/exit:/);
  }, 10000);

  it('disables network for background commands under an allowlist', async () => {
    const r = await BashTool.execute(
      { command: 'echo bg', run_in_background: true },
      allowlistCtx({ sessionDir: tmp }) as never,
    );
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('not supported for background');
  }, 5000);
});
