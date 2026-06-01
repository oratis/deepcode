// Real-kernel integration test for the selective per-domain network allowlist
// (bwrap + slirp4netns + allowlisting DNS proxy). Proves that a domain on the
// allowlist resolves + connects while everything else is blocked at DNS.
//
// GATED: needs bwrap + slirp4netns + the ability to bind 127.0.0.1:53. The CI
// Linux job installs both tools, relaxes net.ipv4.ip_unprivileged_port_start so
// :53 is bindable rootless, and sets DC_SANDBOX_NET_TEST=1. Skips everywhere
// else (macOS / dev machines).
// Spec: docs/DEVELOPMENT_PLAN.md §3.9a

import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SandboxConfig } from '../config/types.js';
import { spawnNetworkSandbox } from './netns.js';

function has(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const RUN =
  process.env.DC_SANDBOX_NET_TEST === '1' &&
  process.platform === 'linux' &&
  has('bwrap') &&
  has('slirp4netns');

interface Res {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runNet(userCommand: string, cwd: string, allowedDomains: string[]): Promise<Res> {
  const config: SandboxConfig = { enabled: true, network: { allowedDomains } };
  const handle = await spawnNetworkSandbox({ userCommand, cwd, config, dnsPort: 53 });
  let stdout = '';
  let stderr = '';
  handle.child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
  handle.child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  const code = await handle.exited;
  await handle.close();
  return { code, stdout, stderr };
}

describe.skipIf(!RUN)('selective network allowlist (slirp4netns, real-kernel)', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-netns-it-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('allows an allowlisted domain and blocks everything else', async () => {
    const cmd = [
      'curl -sS --max-time 15 -o /dev/null -w "ALLOWED=%{http_code}\\n" https://example.com 2>&1 || echo "ALLOWED_ERR=$?"',
      'curl -sS --max-time 15 -o /dev/null -w "DENIED=%{http_code}\\n" https://github.com 2>&1 || echo "DENIED_ERR=$?"',
    ].join('\n');
    const r = await runNet(cmd, cwd, ['example.com', 'www.example.com']);
    // The allowlisted domain resolves (via our proxy → upstream) and connects.
    expect(r.stdout).toMatch(/ALLOWED=2\d\d/);
    // The non-allowlisted domain gets NXDOMAIN from our proxy → can't resolve.
    expect(r.stdout).toMatch(/Could not resolve host: github\.com|DENIED_ERR=6/i);
    expect(r.stdout).not.toMatch(/DENIED=2\d\d/);
  }, 45_000);

  it('resolv.conf inside the sandbox points at the slirp gateway', async () => {
    const r = await runNet('cat /etc/resolv.conf', cwd, ['example.com']);
    expect(r.stdout).toContain('nameserver 10.0.2.2');
  }, 20_000);
});
