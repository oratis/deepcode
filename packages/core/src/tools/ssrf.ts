// SSRF guard — reject fetches that target dangerous IP ranges.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 (M3c-rest) — hardening follow-up.
//
// Threat model: the model is induced (by a malicious page, a poisoned search
// result, or a crafted prompt) to fetch an internal URL. The single highest-value
// SSRF target is the cloud metadata endpoint (169.254.169.254 on AWS/GCP/Azure),
// which can leak instance credentials — that range is NEVER a legitimate fetch
// target, so it is always blocked.
//
// Policy nuance: DeepCode is a *developer* tool, so fetching `localhost:3000` (a
// dev server) or a LAN host is a normal, wanted capability. We therefore split
// ranges into two tiers:
//   · ALWAYS blocked — link-local/metadata, unspecified, multicast/reserved,
//     IETF-protocol. No legitimate use from a fetch tool.
//   · PRIVATE — loopback (127/8, ::1), RFC-1918, CGNAT, ULA. Allowed by default
//     (dev-server workflow); blocked when `allowPrivate` is false (the hardened
//     setting, surfaced via DEEPCODE_FETCH_ALLOW_PRIVATE=0 in the tools).
//
// The WebFetch caller re-checks every redirect hop so a public URL can't bounce
// into a blocked range.
//
// Residual risk (accepted): DNS rebinding in the TOCTOU window between our lookup
// here and undici's resolution at fetch time. Closing it fully requires pinning
// the resolved IP via a custom dispatcher — out of scope for a local dev tool.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** DNS resolver shape — injectable so tests don't hit the network. */
export type Resolver = (
  hostname: string,
  opts: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

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
export function blockedIpReason(ip: string, policy: SsrfPolicy = {}): string | null {
  const allowPrivate = policy.allowPrivate ?? true;
  const kind = isIP(ip);
  if (kind === 4) return blockedV4(ip, allowPrivate);
  if (kind === 6) return blockedV6(ip, allowPrivate);
  return null; // not an IP literal — hostname handling happens in ssrfCheckUrl
}

function blockedV4(ip: string, allowPrivate: boolean): string | null {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return 'malformed IPv4 literal';
  }
  const [a, b, c] = parts as [number, number, number, number];
  // Always blocked — never a legitimate fetch target.
  if (a === 0) return 'this-network/unspecified (0.0.0.0/8)';
  if (a === 169 && b === 254) return 'link-local incl. cloud metadata (169.254.0.0/16)';
  if (a === 192 && b === 0 && c === 0) return 'IETF protocol assignments (192.0.0.0/24)';
  if (a >= 224) return 'multicast/reserved (>=224.0.0.0)';
  // Private — blocked only in hardened mode.
  if (!allowPrivate) {
    if (a === 10) return 'private (10.0.0.0/8)';
    if (a === 127) return 'loopback (127.0.0.0/8)';
    if (a === 172 && b >= 16 && b <= 31) return 'private (172.16.0.0/12)';
    if (a === 192 && b === 168) return 'private (192.168.0.0/16)';
    if (a === 100 && b >= 64 && b <= 127) return 'carrier-grade NAT (100.64.0.0/10)';
    if (a === 198 && (b === 18 || b === 19)) return 'benchmarking (198.18.0.0/15)';
  }
  return null;
}

function blockedV6(ip: string, allowPrivate: boolean): string | null {
  const norm = (ip.toLowerCase().split('%')[0] ?? '').replace(/^\[|\]$/g, ''); // strip zone id + brackets
  // IPv4-mapped (::ffff:a.b.c.d) — fall through to the IPv4 rules.
  const mapped = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blockedV4(mapped[1]!, allowPrivate);
  const head = norm.split(':')[0] ?? '';
  // Always blocked.
  if (norm === '::') return 'unspecified (::)';
  if (/^fe[89ab]/.test(head)) return 'link-local (fe80::/10)';
  if (/^ff/.test(head)) return 'multicast (ff00::/8)';
  // Private — blocked only in hardened mode.
  if (!allowPrivate) {
    if (norm === '::1') return 'loopback (::1)';
    if (/^f[cd]/.test(head)) return 'unique-local (fc00::/7)';
  }
  return null;
}

const BLOCKED_HOSTNAMES = new Set(['metadata.google.internal']);

/**
 * Validate that `url` is safe to fetch. Returns a reason string if it should be
 * blocked, or null if it's allowed. `resolver` defaults to node's DNS lookup;
 * tests inject a stub.
 */
export async function ssrfCheckUrl(
  url: URL,
  policy: SsrfPolicy = {},
  resolver: Resolver = lookup as unknown as Resolver,
): Promise<string | null> {
  const allowPrivate = policy.allowPrivate ?? true;
  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Literal IP in the URL — check directly, no DNS needed.
  if (isIP(host)) {
    const reason = blockedIpReason(host, policy);
    return reason ? `blocked address ${host}: ${reason}` : null;
  }

  // metadata.google.internal is an alias for the metadata IP — block regardless.
  const lower = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) {
    return `blocked internal hostname: ${host}`;
  }
  // localhost / *.local resolve to loopback — only block in hardened mode.
  if (!allowPrivate && (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local'))) {
    return `blocked internal hostname: ${host}`;
  }

  // Resolve and reject if any address is blocked. Resolution failures are left
  // for fetch() to surface as a normal network error.
  let addrs: Array<{ address: string }>;
  try {
    addrs = await resolver(host, { all: true });
  } catch {
    return null;
  }
  for (const a of addrs) {
    const reason = blockedIpReason(a.address, policy);
    if (reason) return `${host} resolves to blocked address ${a.address}: ${reason}`;
  }
  return null;
}

/** Read the hardening flag from the environment. Default: allow private (dev-friendly). */
export function fetchPolicyFromEnv(): SsrfPolicy {
  const v = process.env['DEEPCODE_FETCH_ALLOW_PRIVATE'];
  if (v === '0' || v === 'false' || v === 'no') return { allowPrivate: false };
  return { allowPrivate: true };
}
