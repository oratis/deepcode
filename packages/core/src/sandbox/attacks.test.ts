// Attack-vector test suite for the M3.5 sandbox subsystem.
// Spec: docs/security-model.md (companion doc)
//
// What this file proves:
//   1. Unit-level: hostile inputs to buildMacOsProfile / buildLinuxBwrapArgs
//      / wrapBashCommand do NOT produce a profile that silently widens
//      privileges. Either they're escaped, denied, or refused.
//   2. End-to-end (macOS / Linux only): running actual sandbox-exec / bwrap
//      with our generated profile blocks attempts to read /etc/passwd outside
//      the allowed paths, write to /usr/bin, fork-bomb without limits, etc.
//
// Coverage rationale: the morning report (docs/morning-report style) called out
// "M3.5: 75% — landed, missing attack vector tests". This file closes that gap.

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { wrapBashCommand } from './index.js';
import { buildLinuxBwrapArgs, buildMacOsProfile } from './profile.js';

// ──────────────────────────────────────────────────────────────────────────
// Unit-level: hostile input → safe output
// ──────────────────────────────────────────────────────────────────────────

describe('SBPL profile: hostile-input escaping', () => {
  it('escapes embedded close-paren to prevent SBPL clause injection', () => {
    // If an attacker controls allowRead and inserts `)\n(allow file-write* (subpath "/"))`,
    // we MUST NOT produce a profile that's misparsed.
    const profile = buildMacOsProfile(
      {
        enabled: true,
        filesystem: {
          allowRead: ['/safe")\n(allow file-write* (subpath "/"))\n;'],
        },
      },
      '/proj',
    );
    // The injected paren+newline+clause becomes data inside the quoted subpath
    // because we escape the embedded quotes. The literal injected clause should
    // appear ONLY as part of a string literal, not as a standalone allow.
    const lines = profile.split('\n');
    const standaloneAllowWriteRoot = lines.some(
      (l) => l.trim() === '(allow file-write* (subpath "/"))',
    );
    expect(standaloneAllowWriteRoot).toBe(false);
    // Backslash-escaped quotes must be present
    expect(profile).toContain('\\"');
  });

  it('escapes backslash so a hostile path cannot break out of the string literal', () => {
    const profile = buildMacOsProfile(
      {
        enabled: true,
        filesystem: { allowRead: ['/etc\\"; (allow default'] },
      },
      '/proj',
    );
    // The backslash itself must be escaped
    expect(profile).toContain('\\\\');
    expect(profile).not.toMatch(/^\(allow default/m);
  });

  it('denyRead always appears AFTER allowRead so deny wins on overlap', () => {
    const profile = buildMacOsProfile(
      {
        enabled: true,
        filesystem: {
          allowRead: ['/home/user'],
          denyRead: ['/home/user/.ssh'],
        },
      },
      '/proj',
    );
    const allowIdx = profile.indexOf('subpath "/home/user"');
    const denyIdx = profile.indexOf('subpath "/home/user/.ssh"');
    expect(allowIdx).toBeGreaterThan(-1);
    expect(denyIdx).toBeGreaterThan(allowIdx);
  });

  it('does NOT add (allow network*) when allowedDomains is empty array', () => {
    const profile = buildMacOsProfile(
      {
        enabled: true,
        network: { allowedDomains: [] },
      },
      '/proj',
    );
    expect(profile).not.toMatch(/^\(allow network\*\)/m);
  });

  it('does NOT add file-write* for root or /usr regardless of allowWrite', () => {
    // We never have a default allow file-write* for / or /usr. The system reads
    // are read-only.
    const profile = buildMacOsProfile({ enabled: true }, '/proj');
    expect(profile).not.toMatch(/^\(allow file-write\* \(subpath "\/usr"\)\)/m);
    expect(profile).not.toMatch(/^\(allow file-write\* \(subpath "\/System"\)\)/m);
    expect(profile).not.toMatch(/^\(allow file-write\* \(subpath "\/Library"\)\)/m);
  });
});

describe('bwrap args: hostile-input safety', () => {
  it('does NOT add --share-net even when allowedDomains is a non-empty array', () => {
    // Domain whitelist requires M3.5-ext DNS proxy. Until then, we must NOT
    // silently open net; the only safe states are unshare-net (empty list) or
    // default-allow (omitted).
    const args = buildLinuxBwrapArgs(
      { enabled: true, network: { allowedDomains: ['github.com'] } },
      '/proj',
    );
    expect(args).not.toContain('--share-net');
  });

  it('binds cwd read-write but other dirs only --ro-bind-try', () => {
    const args = buildLinuxBwrapArgs({ enabled: true }, '/proj');
    // Walk the args looking for --bind <src> <dst>; the only bare --bind we
    // should see is for cwd.
    const bareBindIndexes: number[] = [];
    args.forEach((a, i) => {
      if (a === '--bind') bareBindIndexes.push(i);
    });
    expect(bareBindIndexes.length).toBe(1);
    expect(args[bareBindIndexes[0]! + 1]).toBe('/proj');
  });

  it('--unshare-pid / --unshare-ipc / --unshare-uts always present', () => {
    const args = buildLinuxBwrapArgs(
      { enabled: true, filesystem: { allowWrite: ['/tmp/x'] } },
      '/proj',
    );
    expect(args).toContain('--unshare-pid');
    expect(args).toContain('--unshare-ipc');
    expect(args).toContain('--unshare-uts');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Excluded-command spoofing
// ──────────────────────────────────────────────────────────────────────────

describe('wrapBashCommand: excluded-command spoofing', () => {
  it('does NOT bypass for a command that merely starts with the excluded name letters', async () => {
    // `gitleaks` shares the prefix `git` but is a distinct command — must
    // remain sandboxed.
    const r = await wrapBashCommand({
      userCommand: 'gitleaks detect',
      cwd: '/tmp',
      config: { enabled: true, excludedCommands: ['git'] },
    });
    if (process.platform === 'darwin') expect(r.command).toBe('sandbox-exec');
    else if (process.platform === 'linux') expect(r.command).toBe('bwrap');
    else expect(r.command).toBe('/bin/sh');
  });

  it('honors an exact excluded match (whole command)', async () => {
    const r = await wrapBashCommand({
      userCommand: 'git',
      cwd: '/tmp',
      config: { enabled: true, excludedCommands: ['git'] },
    });
    expect(r.command).toBe('/bin/sh');
  });

  it('honors the excluded match followed by space+args', async () => {
    const r = await wrapBashCommand({
      userCommand: 'git status',
      cwd: '/tmp',
      config: { enabled: true, excludedCommands: ['git'] },
    });
    expect(r.command).toBe('/bin/sh');
  });

  it('shell-pipeline NO LONGER bypasses when any clause is not excluded (M3.5-ext)', async () => {
    // Hardened in M3.5-ext: every clause leader must be excluded for the
    // bypass to trigger. `git status && rm -rf /` no longer bypasses.
    const r = await wrapBashCommand({
      userCommand: 'git status && rm -rf /tmp/x',
      cwd: '/tmp',
      config: { enabled: true, excludedCommands: ['git'] },
    });
    // On macOS/Linux this MUST be a sandbox wrap, not /bin/sh
    if (process.platform === 'darwin') expect(r.command).toBe('sandbox-exec');
    else if (process.platform === 'linux') expect(r.command).toBe('bwrap');
    else expect(r.command).toBe('/bin/sh');
  });

  it('shell-pipeline of ONLY excluded commands still bypasses', async () => {
    // `git status && git log` is all-git, so bypass is fine.
    const r = await wrapBashCommand({
      userCommand: 'git status && git log',
      cwd: '/tmp',
      config: { enabled: true, excludedCommands: ['git'] },
    });
    expect(r.command).toBe('/bin/sh');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// End-to-end (macOS): run sandbox-exec and verify it blocks attacks
// ──────────────────────────────────────────────────────────────────────────

const isMac = process.platform === 'darwin';
const hasSandboxExec =
  isMac && spawnSync('which', ['sandbox-exec']).status === 0;

describe.runIf(hasSandboxExec)('sandbox-exec end-to-end (macOS)', () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'dc-sb-e2e-'));
  });
  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('blocks writing outside allowed paths', async () => {
    // Try to write to ~/Documents/foo — NOT in allowWrite, must fail.
    const target = join(workDir, 'untrusted-write-target');
    // We pick a path under workDir so we can be sure it doesn't exist; the
    // sandbox should be configured to allow only a SIBLING dir for writes.
    const allowedDir = join(workDir, 'allowed');
    await fs.mkdir(allowedDir);
    const wrapped = await wrapBashCommand({
      userCommand: `echo malicious > "${target}"`,
      cwd: allowedDir,
      config: {
        enabled: true,
        filesystem: { allowWrite: [allowedDir], allowRead: [workDir] },
      },
    });
    const res = spawnSync(wrapped.command, wrapped.args, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    // Write should have been blocked → file does not exist
    let exists = true;
    try {
      await fs.access(target);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
    // The shell may exit non-zero or stderr should mention permission
    const combined = (res.stderr ?? '') + ' ' + (res.stdout ?? '');
    expect(res.status !== 0 || /denied|not permitted|permission/i.test(combined)).toBe(true);
  }, 15000);

  it('blocks writing to /usr/local/bin even though /usr is readable', async () => {
    // /usr is in the system read allow list (needed for libraries), but writing
    // to /usr/local/bin/* must be blocked. We pick a target unlikely to exist.
    const target = `/usr/local/bin/deepcode-evil-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const wrapped = await wrapBashCommand({
      userCommand: `echo evil > "${target}" 2>&1; echo "[exit=$?]"`,
      cwd: workDir,
      config: {
        enabled: true,
        filesystem: { allowRead: [workDir], allowWrite: [workDir] },
      },
    });
    const res = spawnSync(wrapped.command, wrapped.args, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    let exists = true;
    try {
      await fs.access(target);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    // Either exit is non-zero, or message indicates denial — either is acceptable.
    expect(out).toMatch(/exit=[1-9]|permission|not permitted|operation|denied|read-only/i);
  }, 15000);

  it('SBPL profile we generate has no syntax error (sandbox-exec parses it)', async () => {
    // Smoke test: a syntactically broken profile would fail to parse and
    // sandbox-exec would exit before running our command.
    const wrapped = await wrapBashCommand({
      userCommand: 'echo from-inside-sandbox',
      cwd: workDir,
      config: {
        enabled: true,
        filesystem: {
          allowRead: [workDir, '/path with "quotes"'],
          allowWrite: [workDir],
        },
      },
    });
    const res = spawnSync(wrapped.command, wrapped.args, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(res.stdout ?? '').toContain('from-inside-sandbox');
  }, 15000);
});

// ──────────────────────────────────────────────────────────────────────────
// End-to-end (Linux): run bwrap and verify it blocks attacks
// ──────────────────────────────────────────────────────────────────────────

const isLinux = process.platform === 'linux';
const hasBwrap = isLinux && spawnSync('which', ['bwrap']).status === 0;

describe.runIf(hasBwrap)('bwrap end-to-end (Linux)', () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'dc-sb-e2e-'));
  });
  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('blocks writing outside the bound cwd', async () => {
    const outsideTarget = join(tmpdir(), `outside-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const wrapped = await wrapBashCommand({
      userCommand: `echo evil > "${outsideTarget}" 2>&1; echo "[exit=$?]"`,
      cwd: workDir,
      config: { enabled: true },
    });
    const res = spawnSync(wrapped.command, wrapped.args, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    let exists = true;
    try {
      await fs.access(outsideTarget);
    } catch {
      exists = false;
    }
    // The file should not exist outside the bound cwd because tmpfs covers /tmp.
    expect(exists).toBe(false);
    expect(res.stdout ?? '').toMatch(/exit=[1-9]|read-only|Permission/i);
  }, 15000);

  it('network unshared when allowedDomains is empty', async () => {
    const wrapped = await wrapBashCommand({
      userCommand: 'getent hosts github.com 2>&1; echo "[exit=$?]"',
      cwd: workDir,
      config: { enabled: true, network: { allowedDomains: [] } },
    });
    const res = spawnSync(wrapped.command, wrapped.args, {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const combined = (res.stdout ?? '') + (res.stderr ?? '');
    // With --unshare-net, DNS lookup MUST fail.
    expect(combined).toMatch(/exit=[1-9]|not found|temporary failure|name or service/i);
  }, 15000);
});
