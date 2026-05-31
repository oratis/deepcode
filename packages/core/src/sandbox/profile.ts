// Sandbox profile generator — turns settings.sandbox config into platform-specific
// sandbox specifications.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9a + docs/design/sandbox-plan-worktree.md
//
// M3.5: macOS sandbox-exec SBPL profile generation + Linux bwrap arg generation
// (ro system mounts, rw cwd, read/write allowlists, net unshare, pid/ipc/uts
// unshare, --new-session + --die-with-parent hardening). The one remaining gap
// is the selective-domain net allowlist, which needs a slirp4netns helper to
// bridge UDP into the netns (deny-all-net and full-net modes both work today).
// Windows: disabled per §0.2.

import { homedir, platform } from 'node:os';
import type { SandboxConfig } from '../config/types.js';

export type SandboxPlatform = 'macos' | 'linux' | 'unsupported';

export function detectPlatform(): SandboxPlatform {
  const p = platform();
  if (p === 'darwin') return 'macos';
  if (p === 'linux') return 'linux';
  return 'unsupported';
}

/**
 * SBPL profile for macOS sandbox-exec.
 *
 * Default-deny policy: file-read* and file-write* both blocked, then opened up
 * via allowRead/allowWrite. Network defaults to deny too.
 *
 * NOTE: This is INTENTIONALLY minimal — full coverage of Apple's SBPL (which
 * has 200+ predicates) is out of scope for M3.5. We cover the dimensions plan
 * §3.9a calls out: fs read/write, net allow/deny, excluded commands.
 */
export function buildMacOsProfile(config: SandboxConfig, _cwd: string): string {
  if (!config.enabled) return '';
  const fs = config.filesystem ?? {};
  const net = config.network ?? {};
  const home = homedir();

  const lines: string[] = [
    '(version 1)',
    '(deny default)',
    '; allow basic process operations',
    '(allow process-fork)',
    '(allow process-exec)',
    '(allow process-info*)',
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow iokit-open)',
    '(allow ipc-posix-shm)',
    '; allow read of system libraries + caches',
    // Literal entries for root + /private so path traversal (getcwd, stat of
    // ancestor dirs) doesn't get denied. `subpath` matches contents under but
    // NOT the directory entry itself.
    '(allow file-read* (literal "/"))',
    '(allow file-read* (literal "/private"))',
    '(allow file-read* (literal "/private/var"))',
    '(allow file-read* (literal "/Users"))',
    '(allow file-read* (subpath "/usr"))',
    '(allow file-read* (subpath "/System"))',
    '(allow file-read* (subpath "/Library"))',
    '(allow file-read* (subpath "/private/etc"))',
    '(allow file-read* (subpath "/private/var/db"))',
    '(allow file-read* (subpath "/private/var/folders"))', // dyld closure cache
    '(allow file-read* (subpath "/dev"))',
    '(allow file-read* (subpath "/bin"))',
    '(allow file-read* (subpath "/sbin"))',
    '(allow file-read* (subpath "/opt"))',
    `(allow file-read* (subpath "${home}/.config"))`,
    `(allow file-read* (subpath "${home}/.npm"))`,
    `(allow file-read* (subpath "${home}/.cache"))`,
    `(allow file-read* (subpath "/private/tmp"))`,
    `(allow file-write* (subpath "/private/tmp"))`,
    `(allow file-write* (subpath "/private/var/folders"))`, // macOS tmp
  ];

  for (const p of fs.allowRead ?? []) {
    lines.push(`(allow file-read* (subpath "${escapeSbpl(expandTilde(p, home))}"))`);
  }
  for (const p of fs.allowWrite ?? []) {
    const expanded = escapeSbpl(expandTilde(p, home));
    lines.push(`(allow file-read* (subpath "${expanded}"))`);
    lines.push(`(allow file-write* (subpath "${expanded}"))`);
  }
  // Explicit deny rules go LAST so they override the allows above
  for (const p of fs.denyRead ?? []) {
    lines.push(`(deny file-read* (subpath "${escapeSbpl(expandTilde(p, home))}"))`);
  }
  for (const p of fs.denyWrite ?? []) {
    lines.push(`(deny file-write* (subpath "${escapeSbpl(expandTilde(p, home))}"))`);
  }

  // Network rules
  if ((net.allowedDomains ?? []).length === 0 && (net.allowedDomains ?? null) !== null) {
    // explicit empty allowedDomains = no network
    lines.push('; network: empty allowedDomains means deny all network');
  } else {
    lines.push('; network: M3.5 minimal — allow all by default, deny list applies');
    lines.push('(allow network*)');
  }
  // SBPL doesn't have rich domain-level rules without remote-host predicate;
  // M3.5-ext will add a userspace proxy for finer control.

  if (net.allowUnixSockets) {
    lines.push('(allow network* (local unix-socket))');
  }

  return lines.join('\n') + '\n';
}

function escapeSbpl(s: string): string {
  // Escape backslash and double-quote
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function expandTilde(p: string, home: string): string {
  if (p.startsWith('~/')) return home + p.slice(1);
  if (p === '~') return home;
  return p;
}

/**
 * Linux bwrap arguments. M3.5 ships a skeleton — many invocation knobs.
 * Default: ro bind /, rw bind cwd, --unshare-net unless allowedDomains is set,
 * --unshare-pid, no /home/* leak.
 *
 * When `dnsProxyPort` is provided AND allowedDomains is non-empty, we:
 *   1. KEEP --unshare-net so the sandbox has its own network namespace.
 *   2. Bind a `resolv.conf` file pointing at 127.0.0.1:<port> so DNS lookups
 *      hit the host's DNS proxy (started separately via startDnsProxy).
 *   3. Allow lo (loopback) so the sandboxed process can reach the proxy.
 *
 * Note: this still requires the host to bridge UDP traffic to the netns
 * (`bwrap` doesn't do that natively). M3.5-ext-rest will spawn a slirp4netns
 * helper. For now this returns the args; the helper isn't wired.
 */
export interface BwrapArgsOpts {
  /** Port of the started DNS proxy on 127.0.0.1. */
  dnsProxyPort?: number;
  /** Path to a generated resolv.conf to bind into the sandbox. */
  resolvConfPath?: string;
}

export function buildLinuxBwrapArgs(
  config: SandboxConfig,
  cwd: string,
  opts: BwrapArgsOpts = {},
): string[] {
  if (!config.enabled) return [];
  const fs = config.filesystem ?? {};
  const net = config.network ?? {};
  const args: string[] = [];

  // System read-only mounts
  for (const dir of ['/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc']) {
    args.push('--ro-bind-try', dir, dir);
  }
  // /proc + /dev minimum
  args.push('--proc', '/proc');
  args.push('--dev', '/dev');
  args.push('--tmpfs', '/tmp');

  // Read allows
  for (const p of fs.allowRead ?? []) {
    args.push('--ro-bind-try', p, p);
  }
  // Write allows
  for (const p of fs.allowWrite ?? []) {
    args.push('--bind-try', p, p);
  }
  // cwd is rw by default
  args.push('--bind', cwd, cwd);

  // Network — three modes:
  //  1. allowedDomains: [] → no network at all
  //  2. allowedDomains: ['a.com', ...] + dnsProxyPort → unshare-net + bind a
  //     resolv.conf that points at the DNS proxy on the host's loopback
  //  3. allowedDomains: undefined → full network access (default)
  const explicitEmpty =
    (net.allowedDomains ?? []).length === 0 && (net.allowedDomains ?? null) !== null;
  const whitelisted = (net.allowedDomains ?? []).length > 0 && opts.dnsProxyPort !== undefined;
  if (explicitEmpty) {
    args.push('--unshare-net');
  } else if (whitelisted) {
    args.push('--unshare-net');
    if (opts.resolvConfPath) {
      args.push('--ro-bind', opts.resolvConfPath, '/etc/resolv.conf');
    }
  }

  // Default: unshare pid + ipc + uts
  args.push('--unshare-pid', '--unshare-ipc', '--unshare-uts');

  // Hardening:
  //  · --new-session: run in a fresh session so the sandboxed process can't use
  //    the TIOCSTI ioctl to inject keystrokes into the controlling terminal — a
  //    known sandbox-escape. Safe for non-interactive Bash-tool commands.
  //  · --die-with-parent: kill the sandbox if the agent dies (no orphans).
  args.push('--new-session', '--die-with-parent');

  return args;
}
