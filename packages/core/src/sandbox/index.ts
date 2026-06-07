// Sandbox subsystem entry — wraps Bash invocations under macOS sandbox-exec or
// Linux bwrap based on settings.sandbox + platform.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9a
// Milestone: M3.5

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SandboxConfig } from '../config/types.js';
import { allClausesExcluded } from './pipeline.js';
import { buildLinuxBwrapArgs, buildMacOsProfile, detectPlatform } from './profile.js';

export {
  buildMacOsProfile,
  buildLinuxBwrapArgs,
  detectPlatform,
  type SandboxPlatform,
} from './profile.js';

export { splitClauses, allClausesExcluded, type Clause } from './pipeline.js';

export {
  startDnsProxy,
  parseQName,
  buildNxDomain,
  type DnsProxyOpts,
  type DnsProxyHandle,
} from './dns-proxy.js';

export {
  spawnNetworkSandbox,
  needsNetworkSandbox,
  denyAllNetwork,
  NetworkSandboxUnavailable,
  type SpawnNetworkSandboxOpts,
  type NetworkSandboxHandle,
} from './netns.js';

export type { BwrapArgsOpts } from './profile.js';

export interface SandboxedCommand {
  /** Command + args to spawn (the actual sandbox wrapper invocation). */
  command: string;
  args: string[];
}

/**
 * Return a sandbox config with `dirs` added to the writable filesystem roots —
 * this is how `/add-dir` (settings.permissions.additionalDirectories) grants the
 * sandboxed Bash tool write access beyond cwd. A no-op when the sandbox is off
 * (undefined config) or there are no dirs. Pure — never mutates the input.
 */
export function withAdditionalWritableDirs(
  config: SandboxConfig | undefined,
  dirs: string[] | undefined,
): SandboxConfig | undefined {
  if (!config || !dirs?.length) return config;
  const allowWrite = [...new Set([...(config.filesystem?.allowWrite ?? []), ...dirs])];
  return { ...config, filesystem: { ...config.filesystem, allowWrite } };
}

/**
 * Wrap a user-supplied shell command under platform sandbox.
 *
 * Returns the wrapped (command, args) to pass to child_process.spawn.
 * If sandbox is disabled OR the platform is unsupported, returns the
 * unwrapped equivalent of /bin/sh -c <userCommand>.
 *
 * Also honors `excludedCommands` — commands whose argv[0] matches an excluded
 * entry bypass the sandbox. Useful for `git` (which needs broad fs access).
 */
export async function wrapBashCommand(args: {
  userCommand: string;
  cwd: string;
  config: SandboxConfig | undefined;
}): Promise<SandboxedCommand> {
  const config = args.config;
  if (!config?.enabled) {
    return { command: '/bin/sh', args: ['-c', args.userCommand] };
  }

  // Excluded commands: skip sandbox ONLY if EVERY clause in the pipeline is
  // an excluded command. `git status && rm -rf /` does not bypass because
  // `rm` isn't excluded.
  const excluded = config.excludedCommands ?? [];
  if (excluded.length > 0 && allClausesExcluded(args.userCommand, excluded)) {
    return { command: '/bin/sh', args: ['-c', args.userCommand] };
  }

  const platform = detectPlatform();
  if (platform === 'macos') {
    const profile = buildMacOsProfile(config, args.cwd);
    const profilePath = join(tmpdir(), `deepcode-sb-${process.pid}-${Date.now().toString(36)}.sb`);
    await fs.writeFile(profilePath, profile, 'utf8');
    return {
      command: 'sandbox-exec',
      args: ['-f', profilePath, '/bin/sh', '-c', args.userCommand],
    };
  }
  if (platform === 'linux') {
    const bwrapArgs = buildLinuxBwrapArgs(config, args.cwd);
    return {
      command: 'bwrap',
      args: [...bwrapArgs, '/bin/sh', '-c', args.userCommand],
    };
  }
  // Windows / unsupported: explicit per §0.2 — sandbox disabled, run unwrapped
  return { command: '/bin/sh', args: ['-c', args.userCommand] };
}
