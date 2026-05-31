// launchd plist installer for DeepCode's cron-like scheduled tasks.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 (M8 — scheduled tasks daemon)
//
// On macOS we ship a single LaunchAgent that fires every minute and dispatches
// any scheduled DeepCode tasks. We don't shell out to crontab — too brittle.
// On Linux this is a no-op (M8-ext: write a systemd timer).

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LAUNCHD_LABEL = 'dev.deepcode.scheduler';

export interface LaunchdInstallOpts {
  /** Override HOME for tests. */
  home?: string;
  /** Path to the deepcode binary (absolute). */
  binPath: string;
  /** Subcommand to invoke (default: "scheduler run"). */
  subcommand?: string;
  /**
   * Explicit ProgramArguments, used verbatim (NOT space-split). Takes
   * precedence over binPath+subcommand. Use this when the launcher path or
   * any argument may contain spaces — e.g. `[node, "/path with space/cli.js",
   * "scheduler", "run"]`.
   */
  programArgs?: string[];
  /** Run interval in seconds — default 60. */
  intervalSec?: number;
}

export function launchdPlistPath(home: string = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

/**
 * Generate the plist XML body (pure — easy to test). The real install/uninstall
 * also writes the file and `launchctl load`s it.
 */
export function buildPlist(opts: LaunchdInstallOpts): string {
  const sub = (opts.subcommand ?? 'scheduler run').split(' ').filter(Boolean);
  const interval = opts.intervalSec ?? 60;
  const argv = opts.programArgs ?? [opts.binPath, ...sub];
  const programArgs = argv.map((s) => `      <string>${escapeXml(s)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(opts.home ?? homedir(), '.deepcode', 'scheduler.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(opts.home ?? homedir(), '.deepcode', 'scheduler.err.log'))}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

/**
 * Write the plist to ~/Library/LaunchAgents/. Caller is responsible for
 * `launchctl load -w <path>` (we don't shell out from a pure module).
 * Returns the absolute path of the written plist.
 */
export async function installPlist(opts: LaunchdInstallOpts): Promise<string> {
  const path = launchdPlistPath(opts.home);
  const xml = buildPlist(opts);
  await fs.mkdir(join(opts.home ?? homedir(), 'Library', 'LaunchAgents'), {
    recursive: true,
  });
  await fs.writeFile(path, xml, 'utf8');
  return path;
}

/**
 * Remove the plist. Idempotent.
 */
export async function uninstallPlist(home: string = homedir()): Promise<boolean> {
  const path = launchdPlistPath(home);
  try {
    await fs.unlink(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
