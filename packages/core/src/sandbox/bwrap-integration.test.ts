// Real-kernel integration tests for the Linux bwrap sandbox. The rest of the
// sandbox suite only checks ARG GENERATION; these actually spawn bwrap and
// assert behavior. Gated on `bwrap` being present, so they run on the Linux CI
// runner (which installs bubblewrap + relaxes the userns restriction) and skip
// on macOS / dev machines without bwrap.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9a

import { execSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SandboxConfig } from '../config/types.js';
import { wrapBashCommand } from './index.js';

function hasBwrap(): boolean {
  try {
    execSync('command -v bwrap', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runSandboxed(
  userCommand: string,
  cwd: string,
  config: SandboxConfig,
): Promise<RunResult> {
  const wrapped = await wrapBashCommand({ userCommand, cwd, config });
  return new Promise<RunResult>((resolve) => {
    const child = spawn(wrapped.command, wrapped.args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: `${stderr}${String(e)}` }));
  });
}

const RUN = hasBwrap();

describe.skipIf(!RUN)('bwrap sandbox (real-kernel integration)', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-bwrap-int-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const base = (extra: Partial<SandboxConfig> = {}): SandboxConfig => ({ enabled: true, ...extra });

  it('permits writes inside the rw-bound cwd', async () => {
    const r = await runSandboxed(`echo hi > ${cwd}/out.txt && cat ${cwd}/out.txt`, cwd, base());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('hi');
    expect(await readFile(join(cwd, 'out.txt'), 'utf8')).toContain('hi');
  });

  it('blocks writes to a read-only system path (/etc)', async () => {
    const r = await runSandboxed('echo x > /etc/dc-should-not-exist', cwd, base());
    expect(r.code).not.toBe(0);
    expect(r.stderr.toLowerCase()).toMatch(/read-only|permission|denied/);
  });

  it('can read system libraries (ro-bound /usr) — sandbox is usable', async () => {
    const r = await runSandboxed('ls /usr/bin >/dev/null && echo ok', cwd, base());
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ok');
  });

  it('deny-all network (allowedDomains: []) → outbound fails (own netns)', async () => {
    // curl can't resolve/connect inside an empty network namespace; fails fast
    // regardless of the runner's own connectivity.
    const r = await runSandboxed(
      'curl -sS --max-time 8 https://example.com -o /dev/null; echo "exit=$?"',
      cwd,
      base({ network: { allowedDomains: [] } }),
    );
    expect(r.stdout).not.toContain('exit=0');
  }, 20_000);
});
