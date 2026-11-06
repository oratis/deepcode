import type { SandboxConfig, SandboxMode } from '../config/types.js';
export { buildMacOsProfile, buildLinuxBwrapArgs, detectPlatform, type SandboxPlatform, } from './profile.js';
export { splitClauses, allClausesExcluded, type Clause } from './pipeline.js';
export { startDnsProxy, parseQName, buildNxDomain, type DnsProxyOpts, type DnsProxyHandle, } from './dns-proxy.js';
export { spawnNetworkSandbox, needsNetworkSandbox, denyAllNetwork, NetworkSandboxUnavailable, type SpawnNetworkSandboxOpts, type NetworkSandboxHandle, } from './netns.js';
export type { BwrapArgsOpts } from './profile.js';
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
export declare function wrapBashCommand(args: {
    userCommand: string;
    cwd: string;
    config: SandboxConfig | undefined;
    /**
     * Mode to apply when the config names none. Hosts pass the resolved policy;
     * library callers that omit it keep the historical "off unless configured"
     * behaviour so an embedder can't be silently sandboxed by an upgrade.
     */
    defaultMode?: SandboxMode;
}): Promise<SandboxedCommand>;
export { withAdditionalWritableDirs } from './additional-dirs.js';
export { SANDBOX_MODES, isSandboxMode, resolveSandboxMode, sandboxConfigForMode, describeSandboxMode, withSandboxMode, } from './policy.js';
//# sourceMappingURL=index.d.ts.map