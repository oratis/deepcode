/** DNS resolver shape — injectable so tests don't hit the network. */
export type Resolver = (hostname: string, opts: {
    all: true;
}) => Promise<Array<{
    address: string;
    family: number;
}>>;
export interface SsrfPolicy {
    /**
     * When true (default), loopback + RFC-1918 + CGNAT + ULA are allowed so the
     * agent can reach a local dev server or LAN host. When false, those are also
     * blocked. The always-unsafe ranges (metadata/link-local etc.) block regardless.
     */
    allowPrivate?: boolean;
}
/**
 * Returns a human-readable reason if `ip` (an IPv4 or IPv6 literal) is in a
 * blocked range, or null if it's allowed (or not an IP literal at all).
 */
export declare function blockedIpReason(ip: string, policy?: SsrfPolicy): string | null;
/**
 * Validate that `url` is safe to fetch. Returns a reason string if it should be
 * blocked, or null if it's allowed. `resolver` defaults to node's DNS lookup;
 * tests inject a stub.
 */
export declare function ssrfCheckUrl(url: URL, policy?: SsrfPolicy, resolver?: Resolver): Promise<string | null>;
/** Read the hardening flag from the environment. Default: allow private (dev-friendly). */
export declare function fetchPolicyFromEnv(): SsrfPolicy;
//# sourceMappingURL=ssrf.d.ts.map