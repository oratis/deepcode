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

/** Shutdown bookkeeping shared between the server socket and in-flight forwards. */
interface ProxyState {
  /** Set synchronously by close(), before the server socket is torn down. */
  closed: boolean;
  /** Abandon callbacks, keyed by upstream socket, for forwards still in flight. */
  pending: Map<Socket, () => void>;
}

export async function startDnsProxy(opts: DnsProxyOpts): Promise<DnsProxyHandle> {
  const allowed = new Set(opts.allowedDomains.map((d) => d.toLowerCase()));
  const upstream = opts.upstream ?? '1.1.1.1';
  const upstreamPort = opts.upstreamPort ?? 53;
  const log = opts.log ?? (() => {});
  const sock = createSocket('udp4');
  const state: ProxyState = { closed: false, pending: new Map() };

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
    forward(sock, msg, rinfo, upstream, upstreamPort, state).catch((err: Error) => {
      log(`[dns-proxy] forward error: ${err.message}`);
      // Same shutdown hazard as inside forward(): a rejection can land after
      // close(), and send() on a closed socket throws synchronously here.
      if (state.closed) return;
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

  // The NXDOMAIN sends above pass no callback, so a failed send (say, the
  // client's address became unreachable when its netns went away) surfaces as
  // an 'error' event — and an unlistened 'error' event kills the host process.
  sock.on('error', (err) => {
    log(`[dns-proxy] socket error: ${err.message}`);
  });

  const port = sock.address().port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        // Flag first: forwards check this before touching `sock`, and both run
        // on the same thread, so nothing can slip between the check and a send.
        state.closed = true;
        // Snapshot — abandoning a forward removes it from the map.
        for (const abandon of [...state.pending.values()]) abandon();
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
    // The root label ends the name. `pos` is not read after the loop, so
    // there is nothing left to consume it for.
    if (len === 0) break;
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
  upstreamPort: number,
  state: ProxyState,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upSock = createSocket('udp4');
    const timer = setTimeout(() => {
      release();
      reject(new Error('upstream timeout'));
    }, 5000);

    /** Drop the upstream socket and its timer. Safe to call more than once. */
    function release(): void {
      clearTimeout(timer);
      state.pending.delete(upSock);
      try {
        upSock.close();
      } catch {
        // Already closed.
      }
    }

    // close() calls this for every forward still waiting: the proxy socket is
    // gone, so nobody is left to answer, and leaving the timer armed would
    // hold the event loop open for another 5s.
    state.pending.set(upSock, () => {
      release();
      resolve();
    });

    upSock.once('message', (msg) => {
      release();
      // The proxy can be closed while the reply is in flight. send() on a
      // closed socket throws ERR_SOCKET_DGRAM_NOT_RUNNING synchronously from
      // inside this handler — past the executor's synchronous phase, so the
      // promise never sees it and it escapes as an uncaught exception.
      if (state.closed) {
        resolve();
        return;
      }
      serverSock.send(msg, reply.port, reply.address, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    upSock.once('error', (err) => {
      release();
      reject(err);
    });

    upSock.send(query, upstreamPort, upstream);
  });
}
