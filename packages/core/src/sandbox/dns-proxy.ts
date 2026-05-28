// DNS proxy for sandbox `network.allowedDomains` enforcement.
// Spec: docs/security-model.md (M3.5-ext)
//
// Without OS-level DNS hooking, we can't truly intercept every connect()
// call from sandboxed processes. What we CAN do: run a local UDP DNS
// resolver that ONLY answers queries for whitelisted domains, and have the
// sandbox's resolv.conf point at us. Anything else returns NXDOMAIN.
//
// This is M3.5-ext scaffold. Full integration with `sandbox-exec` /
// `bwrap` requires writing a resolv.conf into the sandbox + plumbing
// 127.0.0.1:<port> in. The resolver itself is straightforward.

import { createSocket, type Socket } from 'node:dgram';

export interface DnsProxyOpts {
  /** Domains that should resolve. Subdomains are NOT included; use explicit entries. */
  allowedDomains: string[];
  /** Upstream DNS server for allowed lookups (default 1.1.1.1). */
  upstream?: string;
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

export async function startDnsProxy(opts: DnsProxyOpts): Promise<DnsProxyHandle> {
  const allowed = new Set(opts.allowedDomains.map((d) => d.toLowerCase()));
  const upstream = opts.upstream ?? '1.1.1.1';
  const log = opts.log ?? (() => {});
  const sock = createSocket('udp4');

  sock.on('message', (msg, rinfo) => {
    const domain = parseQName(msg);
    if (!domain) {
      sock.send(buildNxDomain(msg), rinfo.port, rinfo.address);
      return;
    }
    const norm = domain.toLowerCase().replace(/\.$/, '');
    if (!allowed.has(norm)) {
      log(`[dns-proxy] DENY ${norm}`);
      sock.send(buildNxDomain(msg), rinfo.port, rinfo.address);
      return;
    }
    log(`[dns-proxy] ALLOW ${norm} → ${upstream}`);
    forward(sock, msg, rinfo, upstream).catch((err: Error) => {
      log(`[dns-proxy] forward error: ${err.message}`);
      sock.send(buildNxDomain(msg), rinfo.port, rinfo.address);
    });
  });

  await new Promise<void>((resolve, reject) => {
    sock.once('error', reject);
    sock.bind(opts.bindPort ?? 0, opts.bindAddr ?? '127.0.0.1', () => {
      sock.removeListener('error', reject);
      resolve();
    });
  });

  const port = sock.address().port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        try {
          sock.close(() => resolve());
        } catch {
          resolve();
        }
      }),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Tiny DNS wire-format helpers
// ──────────────────────────────────────────────────────────────────────────

/** Extract the QNAME from a DNS request packet. Returns null on parse error. */
export function parseQName(buf: Buffer): string | null {
  if (buf.length < 13) return null; // header(12) + at least one length byte
  let pos = 12; // skip 12-byte header
  const parts: string[] = [];
  while (pos < buf.length) {
    const len = buf[pos];
    if (len === undefined) return null;
    if (len === 0) {
      pos++;
      break;
    }
    if (len > 63) return null; // compression / invalid
    pos++;
    if (pos + len > buf.length) return null;
    parts.push(buf.toString('utf8', pos, pos + len));
    pos += len;
  }
  return parts.join('.');
}

/** Build an NXDOMAIN response that matches the query's transaction ID. */
export function buildNxDomain(query: Buffer): Buffer {
  if (query.length < 12) return Buffer.alloc(0);
  const resp = Buffer.from(query);
  // Set flags: QR=1 (response), Opcode=0, RA=1, RCODE=3 (NXDOMAIN)
  resp[2] = 0x81; // QR=1, AA=0, TC=0, RD=1
  resp[3] = 0x83; // RA=1, Z=0, RCODE=3
  return resp;
}

/** Forward the query to the upstream DNS and pipe the response back. */
function forward(
  serverSock: Socket,
  query: Buffer,
  reply: { address: string; port: number },
  upstream: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upSock = createSocket('udp4');
    const timer = setTimeout(() => {
      upSock.close();
      reject(new Error('upstream timeout'));
    }, 5000);
    upSock.once('message', (msg) => {
      clearTimeout(timer);
      serverSock.send(msg, reply.port, reply.address, (err) => {
        upSock.close();
        if (err) reject(err);
        else resolve();
      });
    });
    upSock.once('error', (err) => {
      clearTimeout(timer);
      upSock.close();
      reject(err);
    });
    upSock.send(query, 53, upstream);
  });
}
