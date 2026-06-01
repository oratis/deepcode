// Linux selective network allowlist: bwrap (own netns) + slirp4netns (rootless
// userspace NAT for connectivity) + the allowlisting DNS proxy (NXDOMAIN for
// non-allowed domains). The guest's resolv.conf points at the slirp gateway
// (10.0.2.2 → host loopback) where the proxy listens on :53.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9a
//
// THREAT MODEL: DNS-NAME allowlisting. A process that dials a raw IP bypasses
// the allowlist (it never resolves a name). This is adequate for the typical
// agent workload (git / npm / pip over https://host). slirp4netns --disable-dns
// closes the built-in 10.0.2.3 resolver so resolution can ONLY go through our
// allowlisting proxy.
//
// REQUIRES: `bwrap`, `slirp4netns`, and the ability to bind 127.0.0.1:53 (a
// privileged port — needs CAP_NET_BIND_SERVICE or a relaxed
// net.ipv4.ip_unprivileged_port_start). When the proxy can't bind,
// spawnNetworkSandbox throws NetworkSandboxUnavailable so callers fail CLOSED
// (deny-all network) rather than running the command unrestricted.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { SandboxConfig } from '../config/types.js';
import { startDnsProxy, type DnsProxyHandle } from './dns-proxy.js';
import { buildLinuxBwrapArgs } from './profile.js';

/** slirp4netns gateway — maps to the host loopback (no --disable-host-loopback). */
const SLIRP_GATEWAY = '10.0.2.2';
const SLIRP_TAP = 'tap0';
const SLIRP_MTU = 65520;
const DEFAULT_DNS_PORT = 53;
const DEFAULT_READY_TIMEOUT_MS = 10_000;

/** Thrown when the selective allowlist can't be set up; callers fail closed. */
export class NetworkSandboxUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkSandboxUnavailable';
  }
}

/**
 * True iff a command should run under the selective-allowlist network sandbox:
 * Linux + sandbox enabled + `network.allowedDomains` is a NON-EMPTY allowlist.
 * (An empty array means deny-all-net — handled by plain bwrap --unshare-net;
 * `undefined` means full network — no netns orchestration needed.)
 */
export function needsNetworkSandbox(
  config: SandboxConfig | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!config?.enabled || platform !== 'linux') return false;
  const domains = config.network?.allowedDomains;
  return Array.isArray(domains) && domains.length > 0;
}

/**
 * Derive a deny-all-network config from `config` (allowedDomains: []). Used as
 * the fail-closed fallback when the selective allowlist can't be set up — the
 * command runs with NO network rather than unrestricted.
 */
export function denyAllNetwork(config: SandboxConfig): SandboxConfig {
  return { ...config, network: { ...config.network, allowedDomains: [] } };
}

export interface SpawnNetworkSandboxOpts {
  /** The user shell command to run inside the sandbox. */
  userCommand: string;
  /** Working directory (rw-bound inside the sandbox). */
  cwd: string;
  /** Sandbox config; network.allowedDomains is expected to be a non-empty allowlist. */
  config: SandboxConfig;
  /** Override the bwrap binary (tests / non-standard installs). */
  bwrapPath?: string;
  /** Override the slirp4netns binary. */
  slirpPath?: string;
  /** Upstream resolver for ALLOWED lookups (default 1.1.1.1). */
  dnsUpstream?: string;
  /** Host loopback port for the DNS proxy. MUST be 53 for the guest glibc resolver. */
  dnsPort?: number;
  /** Milliseconds to wait for child-pid + slirp readiness before failing. */
  readyTimeoutMs?: number;
  /** Diagnostic logger. */
  log?: (line: string) => void;
}

export interface NetworkSandboxHandle {
  /** The spawned bwrap process. stdout = stdio[1], stderr = stdio[2]. */
  child: ChildProcess;
  /** Resolves with the bwrap exit code once the sandboxed command finishes. */
  exited: Promise<number | null>;
  /** Tear down slirp4netns + DNS proxy + temp dir. Idempotent. */
  close(): Promise<void>;
}

/**
 * Spawn a bwrap sandbox whose network is restricted to `config.network.allowedDomains`.
 *
 * Orchestration:
 *   1. Start the allowlisting DNS proxy on 127.0.0.1:53.
 *   2. bwrap --unshare-net (own netns) with our resolv.conf bound + --info-fd
 *      (to learn the child PID) + --block-fd (to gate the inner command until
 *      the network is wired up).
 *   3. slirp4netns attaches to the child's netns (entering its userns first) and
 *      provides rootless outbound connectivity via tap0.
 *   4. Once slirp signals ready, release --block-fd so the command runs.
 *
 * On any setup failure this rejects with NetworkSandboxUnavailable after cleaning up.
 */
export async function spawnNetworkSandbox(
  opts: SpawnNetworkSandboxOpts,
): Promise<NetworkSandboxHandle> {
  const log = opts.log ?? (() => {});
  const dnsPort = opts.dnsPort ?? DEFAULT_DNS_PORT;
  const readyTimeout = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const domains = opts.config.network?.allowedDomains ?? [];

  // 1. Allowlisting DNS proxy on the host loopback. Must be :53 because the
  //    guest's glibc resolver always queries nameservers on port 53.
  let dns: DnsProxyHandle;
  try {
    dns = await startDnsProxy({
      allowedDomains: domains,
      upstream: opts.dnsUpstream,
      bindAddr: '127.0.0.1',
      bindPort: dnsPort,
      log,
    });
  } catch (err) {
    throw new NetworkSandboxUnavailable(
      `cannot bind DNS allowlist proxy on 127.0.0.1:${dnsPort} (${errMsg(err)}); selective ` +
        `network allowlisting needs CAP_NET_BIND_SERVICE or a relaxed ` +
        `net.ipv4.ip_unprivileged_port_start`,
    );
  }

  // 2. Temp dir + resolv.conf pointing at the slirp gateway.
  const work = await mkdtemp(join(tmpdir(), 'dc-netns-'));
  const resolvSrc = join(work, 'resolv.conf');
  await writeFile(resolvSrc, `nameserver ${SLIRP_GATEWAY}\noptions timeout:2 attempts:2\n`, 'utf8');
  // /etc/resolv.conf is usually a dangling symlink (→ /run/systemd/resolve/...)
  // that bwrap can't create a bind target for; bind at the resolved real path.
  let resolvDest = '/etc/resolv.conf';
  try {
    resolvDest = await realpath('/etc/resolv.conf');
  } catch {
    /* absent / not a symlink — bind directly */
  }

  // 3. bwrap with its own netns + our resolv.conf + info/block fds.
  //    --uid 0 --gid 0 maps the host user to root INSIDE bwrap's user namespace.
  //    This is what lets slirp4netns (running as the host user, which owns that
  //    userns) gain CAP_SYS_ADMIN on entry and setns() into the netns — without
  //    it, setns(CLONE_NEWNET) fails with EPERM.
  const bwrapArgs = buildLinuxBwrapArgs(opts.config, opts.cwd, {
    dnsProxyPort: dnsPort,
    resolvConfPath: resolvSrc,
    resolvConfDest: resolvDest,
  });
  const args = [
    ...bwrapArgs,
    '--uid',
    '0',
    '--gid',
    '0',
    '--info-fd',
    '3',
    '--block-fd',
    '4',
    '/bin/sh',
    '-c',
    opts.userCommand,
  ];
  // stdio: 0 ignore · 1/2 piped (caller captures) · 3 info-fd (we read) · 4 block-fd (we write)
  const child = spawn(opts.bwrapPath ?? 'bwrap', args, {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    cwd: opts.cwd,
  });
  // Swallow stream/process errors so a SIGTERM-induced ECONNRESET on the info /
  // block / stdio pipes during teardown doesn't surface as an unhandled error.
  ignoreErrors(child);
  child.stdio.forEach((s) => ignoreErrors(s));

  let slirp: ChildProcess | undefined;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    killQuietly(slirp);
    killQuietly(child);
    await dns.close().catch(() => {});
    await rm(work, { recursive: true, force: true }).catch(() => {});
  };

  try {
    // 4. Read the sandbox child-pid from --info-fd (a host-visible PID).
    const childPid = await readChildPid(child.stdio[3] as Readable, child, readyTimeout);
    log(`[netns] bwrap child-pid=${childPid}`);

    // 5. Attach slirp4netns to the sandbox's netns by PID. slirp enters the
    //    target's userns (where the host user is now root, via --uid 0) before
    //    the netns, so the setns is permitted. --disable-dns closes slirp's
    //    built-in 10.0.2.3 resolver so ALL resolution must traverse our proxy.
    slirp = spawn(
      opts.slirpPath ?? 'slirp4netns',
      [
        '--configure',
        '--disable-dns',
        `--mtu=${SLIRP_MTU}`,
        '--ready-fd',
        '3',
        String(childPid),
        SLIRP_TAP,
      ],
      { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] },
    );
    ignoreErrors(slirp);
    slirp.stdio.forEach((s) => ignoreErrors(s));
    pipeLog(slirp.stdio[1] as Readable | null, '[slirp]', log);
    pipeLog(slirp.stdio[2] as Readable | null, '[slirp!]', log);

    // 6. Wait for slirp to signal the interface is configured.
    await waitForReady(slirp.stdio[3] as Readable, slirp, 'slirp4netns ready', readyTimeout);
    log('[netns] slirp4netns ready');

    // 7. Release the inner command — network is now wired up.
    const blockFd = child.stdio[4] as Writable;
    blockFd.write('go');
    blockFd.end();
  } catch (err) {
    await close();
    throw err instanceof NetworkSandboxUnavailable
      ? err
      : new NetworkSandboxUnavailable(`network sandbox setup failed: ${errMsg(err)}`);
  }

  // 8. Auto-teardown slirp + proxy + tmp when the sandboxed command exits.
  const exited = new Promise<number | null>((resolve) => {
    child.once('close', (code) => {
      void close();
      resolve(code);
    });
  });

  return { child, exited, close };
}

/** Parse the `child-pid` out of bwrap's --info-fd JSON (tolerant of chunking). */
function readChildPid(fd: Readable, child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out reading bwrap --info-fd'));
    }, timeoutMs);
    const onData = (d: Buffer): void => {
      buf += d.toString('utf8');
      const m = buf.match(/"child-pid"\s*:\s*(\d+)/);
      if (m) {
        cleanup();
        resolve(Number(m[1]));
      }
    };
    const onExit = (): void => {
      cleanup();
      reject(new Error('bwrap exited before emitting child-pid'));
    };
    function cleanup(): void {
      clearTimeout(timer);
      fd.off('data', onData);
      child.off('exit', onExit);
    }
    fd.on('data', onData);
    child.once('exit', onExit);
  });
}

/** Resolve when the process writes any byte to `fd` (e.g. slirp --ready-fd). */
function waitForReady(
  fd: Readable,
  proc: ChildProcess,
  label: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${label}`));
    }, timeoutMs);
    const onData = (): void => {
      cleanup();
      resolve();
    };
    const onExit = (): void => {
      cleanup();
      reject(new Error(`process exited before ${label}`));
    };
    function cleanup(): void {
      clearTimeout(timer);
      fd.off('data', onData);
      proc.off('exit', onExit);
    }
    fd.on('data', onData);
    proc.once('exit', onExit);
  });
}

function pipeLog(fd: Readable | null, prefix: string, log: (s: string) => void): void {
  if (!fd) return;
  fd.on('data', (d: Buffer) => {
    const s = d.toString('utf8').trimEnd();
    if (s) log(`${prefix} ${s}`);
  });
}

/**
 * Attach a no-op 'error' listener so a stream/process error during teardown
 * (e.g. ECONNRESET on the stdio pipes when slirp/bwrap is SIGTERM'd) doesn't
 * bubble up as an unhandled error. Accepts ChildProcess, streams, or null.
 */
function ignoreErrors(
  emitter: { on(event: 'error', cb: (err: unknown) => void): unknown } | null | undefined,
): void {
  emitter?.on('error', () => {});
}

function killQuietly(proc: ChildProcess | undefined): void {
  if (proc && !proc.killed) {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
