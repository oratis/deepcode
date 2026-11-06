import { type ChildProcess } from 'node:child_process';
import type { SandboxConfig } from '../config/types.js';
/** Thrown when the selective allowlist can't be set up; callers fail closed. */
export declare class NetworkSandboxUnavailable extends Error {
    constructor(message: string);
}
/**
 * True iff a command should run under the selective-allowlist network sandbox:
 * Linux + sandbox enabled + `network.allowedDomains` is a NON-EMPTY allowlist.
 * (An empty array means deny-all-net — handled by plain bwrap --unshare-net;
 * `undefined` means full network — no netns orchestration needed.)
 */
export declare function needsNetworkSandbox(config: SandboxConfig | undefined, platform?: NodeJS.Platform): boolean;
/**
 * Derive a deny-all-network config from `config` (allowedDomains: []). Used as
 * the fail-closed fallback when the selective allowlist can't be set up — the
 * command runs with NO network rather than unrestricted.
 */
export declare function denyAllNetwork(config: SandboxConfig): SandboxConfig;
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
export declare function spawnNetworkSandbox(opts: SpawnNetworkSandboxOpts): Promise<NetworkSandboxHandle>;
//# sourceMappingURL=netns.d.ts.map