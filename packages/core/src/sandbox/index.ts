// Sandbox subsystem entry — wraps Bash invocations under macOS sandbox-exec or
// Linux bwrap based on settings.sandbox + platform.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9a
// Milestone: M3.5

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SandboxConfig } from '../config/types.js';
import { buildLinuxBwrapArgs, buildMacOsProfile, detectPlatform } from './profile.js';

export {
  buildMacOsProfile,
  buildLinuxBwrapArgs,
  detectPlatform,
  type SandboxPlatform,
} from './profile.js';

export interface SandboxedCommand {
  /** Command + args to spawn (the actual sandbox wrapper invocation). */
  command: string;
  args: string[];
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

  // Excluded commands: if userCommand starts with one of these, skip sandbox
  for (const excluded of config.excludedCommands ?? []) {
    if (args.userCommand.startsWith(excluded + ' ') || args.userCommand === excluded) {
      return { command: '/bin/sh', args: ['-c', args.userCommand] };
    }
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
