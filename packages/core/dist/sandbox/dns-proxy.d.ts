export interface DnsProxyOpts {
    /** Domains that should resolve. Subdomains are NOT included; use explicit entries. */
    allowedDomains: string[];
    /** Upstream DNS server for allowed lookups (default 1.1.1.1). */
    upstream?: string;
    /** Upstream DNS port; default 53. Overridable so tests can run a local stub. */
    upstreamPort?: number;
    /** Bind address; default 127.0.0.1. */
    bindAddr?: string;
    /** Bind port; default 0 (random). */
    bindPort?: number;
    /** Optional logger for diagnostics. */
    log?: (line: string) => void;
}
export interface DnsProxyHandle {
    /** Actual bound port. */
    port: number;
    /** Stop the proxy. */
    close: () => Promise<void>;
}
export declare function startDnsProxy(opts: DnsProxyOpts): Promise<DnsProxyHandle>;
/** Extract the QNAME from a DNS request packet. Returns null on parse error. */
export declare function parseQName(buf: Buffer): string | null;
/** Build an NXDOMAIN response that matches the query's transaction ID. */
export declare function buildNxDomain(query: Buffer): Buffer;
//# sourceMappingURL=dns-proxy.d.ts.map