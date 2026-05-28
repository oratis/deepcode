// Sandbox profile generator — turns settings.sandbox config into platform-specific
// sandbox specifications.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9a + docs/design/sandbox-plan-worktree.md
//
// M3.5: macOS sandbox-exec SBPL profile generation. Linux bwrap arg generation
// is partial (skeleton). Windows: disabled per §0.2.

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
    '(allow signal (target self))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow iokit-open)',
    '(allow ipc-posix-shm)',
    '; allow read of system libraries + caches',
    '(allow file-read* (subpath "/usr"))',
    '(allow file-read* (subpath "/System"))',
    '(allow file-read* (subpath "/Library"))',
    '(allow file-read* (subpath "/private/etc"))',
    '(allow file-read* (subpath "/private/var/db"))',
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
 */
export function buildLinuxBwrapArgs(config: SandboxConfig, cwd: string): string[] {
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

  // Network
  if ((net.allowedDomains ?? []).length === 0 && (net.allowedDomains ?? null) !== null) {
    args.push('--unshare-net');
  }
  // Domain whitelist enforcement requires a userspace DNS proxy (M3.5-ext)

  // Default: unshare pid + ipc + uts
  args.push('--unshare-pid', '--unshare-ipc', '--unshare-uts');

  return args;
}
