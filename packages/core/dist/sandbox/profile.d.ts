import type { SandboxConfig } from '../config/types.js';
export type SandboxPlatform = 'macos' | 'linux' | 'unsupported';
export declare function detectPlatform(): SandboxPlatform;
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
export declare function buildMacOsProfile(config: SandboxConfig, cwd: string): string;
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
    /**
     * In-sandbox destination for the resolv.conf bind. Defaults to
     * `/etc/resolv.conf`, but on systemd hosts that path is a dangling symlink
     * (→ /run/systemd/resolve/stub-resolv.conf) which bwrap can't create a bind
     * target for. The orchestrator resolves the symlink (realpath) and passes the
     * real path here so the preserved /etc/resolv.conf symlink leads to our file.
     */
    resolvConfDest?: string;
}
export declare function buildLinuxBwrapArgs(config: SandboxConfig, cwd: string, opts?: BwrapArgsOpts): string[];
//# sourceMappingURL=profile.d.ts.map