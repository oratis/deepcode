// Real-kernel integration tests for the Linux bwrap sandbox. The rest of the
// sandbox suite only checks ARG GENERATION; these actually spawn bwrap and
// assert behavior. Gated on `bwrap` being present, so they run on the Linux CI
// runner (which installs bubblewrap + relaxes the userns restriction) and skip
// on macOS / dev machines without bwrap.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9a

import { execSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SandboxConfig, SandboxMode } from '../config/types.js';
import { wrapBashCommand } from './index.js';

function hasBwrap(): boolean {
  try {
    execSync('command -v bwrap', { stdio: 'ignore' });
    return true;
  } catch {
    // These are the only tests that observe what the Linux sandbox *does*
    // rather than what arguments it produces, and they self-skip. On the Linux
    // runner that has to be a failure: a green suite that skipped every real
    // enforcement check is how `--sandbox read-only` stayed writable.
    if (process.env.DC_REQUIRE_BWRAP === '1') {
      throw new Error('DC_REQUIRE_BWRAP=1 but bwrap is not on PATH');
    }
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
  defaultMode?: SandboxMode,
): Promise<RunResult> {
  const wrapped = await wrapBashCommand({ userCommand, cwd, config, defaultMode });
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
    // Written outside the sandbox, so a read-only run has something to read.
    await writeFile(join(cwd, 'seeded.txt'), 'from outside\n');
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

  // The `--sandbox` axis added in #226 was live-verified on macOS only, where it
  // exposed a profile that denied reads of the project directory itself. Linux
  // shared the mode *resolution* and nothing more: `sandboxConfigForMode` was
  // unit-tested, `buildLinuxBwrapArgs` was argument-tested, and no test ever
  // spawned bwrap in a named mode to see what a command could actually do.
  //
  // A read-only sandbox that cannot read is the failure macOS had. A read-only
  // sandbox that can write is the failure worth catching here.
  describe('modes', () => {
    // No `mode` and no `enabled`, so the mode comes from `defaultMode` — the
    // path every host takes, since #226 made workspace-write the default rather
    // than something each caller sets.
    const unset: SandboxConfig = {};

    it('read-only: the workspace is readable', async () => {
      // This is the assertion macOS failed before #226: a sandbox that denies
      // reads of the project directory makes every command useless.
      const r = await runSandboxed(`cat ${cwd}/seeded.txt`, cwd, { ...unset, mode: 'read-only' });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('from outside');
    });

    it('read-only: the workspace is not writable', async () => {
      const r = await runSandboxed(`echo nope > ${cwd}/written.txt`, cwd, {
        ...unset,
        mode: 'read-only',
      });
      expect(r.code).not.toBe(0);
      expect(r.stderr.toLowerCase()).toMatch(/read-only|permission|denied/);
    });

    it('workspace-write: the workspace is readable and writable', async () => {
      const r = await runSandboxed(
        `cat ${cwd}/seeded.txt && echo ok > ${cwd}/w.txt && cat ${cwd}/w.txt`,
        cwd,
        { ...unset, mode: 'workspace-write' },
      );
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('from outside');
      expect(r.stdout).toContain('ok');
    });

    it('workspace-write: outside the workspace stays read-only', async () => {
      const r = await runSandboxed('echo x > /etc/dc-should-not-exist', cwd, {
        ...unset,
        mode: 'workspace-write',
      });
      expect(r.code).not.toBe(0);
    });

    it('danger-full-access: no bwrap at all', async () => {
      const wrapped = await wrapBashCommand({
        userCommand: 'true',
        cwd,
        config: { ...unset, mode: 'danger-full-access' },
      });
      expect(wrapped.command).toBe('/bin/sh');
    });

    it('defaultMode applies when the config names no mode', async () => {
      // A host passing workspace-write must get a sandbox, not the historical
      // "off unless configured" behaviour.
      const wrapped = await wrapBashCommand({
        userCommand: 'true',
        cwd,
        config: unset,
        defaultMode: 'workspace-write',
      });
      expect(wrapped.command).toBe('bwrap');

      const r = await runSandboxed(`echo ok > ${cwd}/d.txt`, cwd, unset, 'workspace-write');
      expect(r.code).toBe(0);
    });

    it('a library caller with no mode anywhere is still unsandboxed', async () => {
      // Stated in wrapBashCommand's contract: an embedder must not become
      // sandboxed by upgrading.
      const wrapped = await wrapBashCommand({ userCommand: 'true', cwd, config: unset });
      expect(wrapped.command).toBe('/bin/sh');
    });
  });
});
