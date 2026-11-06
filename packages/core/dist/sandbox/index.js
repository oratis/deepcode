// Sandbox subsystem entry — wraps Bash invocations under macOS sandbox-exec or
// Linux bwrap based on settings.sandbox + platform.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9a
// Milestone: M3.5
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveSandboxMode, sandboxConfigForMode } from './policy.js';
import { allClausesExcluded } from './pipeline.js';
import { buildLinuxBwrapArgs, buildMacOsProfile, detectPlatform } from './profile.js';
export { buildMacOsProfile, buildLinuxBwrapArgs, detectPlatform, } from './profile.js';
export { splitClauses, allClausesExcluded } from './pipeline.js';
export { startDnsProxy, parseQName, buildNxDomain, } from './dns-proxy.js';
export { spawnNetworkSandbox, needsNetworkSandbox, denyAllNetwork, NetworkSandboxUnavailable, } from './netns.js';
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
export async function wrapBashCommand(args) {
    const mode = resolveSandboxMode(args.config, args.defaultMode ?? 'danger-full-access');
    const config = sandboxConfigForMode(args.config, mode, args.cwd, await linkedGitDirs(args.cwd));
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
/**
 * The git directories a workspace needs but doesn't contain.
 *
 * In a linked worktree `.git` is a file pointing at
 * `<main>/.git/worktrees/<name>`, and the shared object store lives one level
 * up again — both outside cwd. Sandboxing the workspace without them breaks
 * every git command in exactly the worktrees DeepCode's own EnterWorktree tool
 * creates. Best-effort: any read failure just yields no extra paths.
 */
async function linkedGitDirs(cwd) {
    try {
        const pointer = await fs.readFile(join(cwd, '.git'), 'utf8');
        const match = /^gitdir:\s*(.+)$/m.exec(pointer);
        if (!match)
            return [];
        const gitDir = resolve(cwd, match[1].trim());
        const dirs = [gitDir];
        try {
            const commonDir = (await fs.readFile(join(gitDir, 'commondir'), 'utf8')).trim();
            if (commonDir)
                dirs.push(resolve(gitDir, commonDir));
        }
        catch {
            /* no commondir — a plain gitdir pointer */
        }
        return dirs;
    }
    catch {
        // `.git` is a directory (ordinary repo) or absent — nothing extra needed.
        return [];
    }
}
export { withAdditionalWritableDirs } from './additional-dirs.js';
export { SANDBOX_MODES, isSandboxMode, resolveSandboxMode, sandboxConfigForMode, describeSandboxMode, withSandboxMode, } from './policy.js';
//# sourceMappingURL=index.js.map