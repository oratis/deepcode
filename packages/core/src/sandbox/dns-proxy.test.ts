import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { buildNxDomain, parseQName, startDnsProxy, type DnsProxyHandle } from './dns-proxy.js';

/** Build a minimal DNS query packet for a single domain. */
function buildQuery(domain: string, txnId = 0x1234): Buffer {
  const labels = domain
    .split('.')
    .map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, 'utf8')]));
  const qname = Buffer.concat([...labels, Buffer.from([0])]);
  // Header (12 bytes) + qname + qtype (2) + qclass (2)
  const header = Buffer.alloc(12);
  header.writeUInt16BE(txnId, 0);
  header.writeUInt16BE(0x0100, 2); // flags: RD=1
  header.writeUInt16BE(1, 4); // QDCOUNT=1
  const qtail = Buffer.from([0, 1, 0, 1]); // QTYPE=A, QCLASS=IN
  return Buffer.concat([header, qname, qtail]);
}

describe('parseQName', () => {
  it('extracts a multi-label domain', () => {
    const q = buildQuery('example.com');
    expect(parseQName(q)).toBe('example.com');
  });
  it('extracts a deep domain', () => {
    const q = buildQuery('a.b.c.d.example.com');
    expect(parseQName(q)).toBe('a.b.c.d.example.com');
  });
  it('returns null on too-short packet', () => {
    expect(parseQName(Buffer.alloc(5))).toBeNull();
  });
  it('returns null on invalid label length', () => {
    const bad = Buffer.alloc(20);
    bad[12] = 200; // > 63 → compression / invalid
    expect(parseQName(bad)).toBeNull();
  });
});

describe('buildNxDomain', () => {
  it('preserves the txn ID and sets RCODE=3', () => {
    const q = buildQuery('foo.com', 0x5678);
    const resp = buildNxDomain(q);
    expect(resp.readUInt16BE(0)).toBe(0x5678);
    // Lower nibble of byte 3 is RCODE
    expect(resp[3]! & 0x0f).toBe(3);
    // High bit of byte 2 is QR (1 = response)
    expect(resp[2]! & 0x80).toBe(0x80);
  });
  it('returns empty buffer on too-short input', () => {
    expect(buildNxDomain(Buffer.alloc(5)).length).toBe(0);
  });
});

describe('startDnsProxy', () => {
  let proxy: DnsProxyHandle | null = null;
  afterEach(async () => {
    if (proxy) {
      await proxy.close();
      proxy = null;
    }
  });

  function queryProxy(port: number, domain: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const sock = createSocket('udp4');
      const timer = setTimeout(() => {
        sock.close();
        reject(new Error('query timed out'));
      }, 2000);
      sock.once('message', (msg) => {
        clearTimeout(timer);
        sock.close();
        resolve(msg);
      });
      sock.once('error', (err) => {
        clearTimeout(timer);
        sock.close();
        reject(err);
      });
      sock.send(buildQuery(domain), port, '127.0.0.1');
    });
  }

  it('returns NXDOMAIN for non-allowed domains', async () => {
    proxy = await startDnsProxy({ allowedDomains: ['github.com'], log: () => {} });
    const resp = await queryProxy(proxy.port, 'evil.example.com');
    // RCODE = NXDOMAIN
    expect(resp[3]! & 0x0f).toBe(3);
  });

  it('binds to a local port and reports it', async () => {
    proxy = await startDnsProxy({ allowedDomains: [], log: () => {} });
    expect(proxy.port).toBeGreaterThan(0);
    expect(proxy.port).toBeLessThan(65536);
  });

  it('close() is idempotent', async () => {
    proxy = await startDnsProxy({ allowedDomains: [] });
    await proxy.close();
    await proxy.close();
    proxy = null;
  });
});

// Regression: closing the proxy while a forward is awaiting its upstream reply
// used to call send() on the already-closed server socket. dgram throws
// ERR_SOCKET_DGRAM_NOT_RUNNING *synchronously* from inside the upstream
// 'message' handler, i.e. after the enclosing Promise executor's synchronous
// phase, so the promise never catches it and it surfaces as an uncaught
// exception that fails the whole vitest run.
describe('startDnsProxy shutdown race', () => {
  /** A stub upstream resolver that answers `delayMs` after the query arrives. */
  function startStubUpstream(delayMs: number): Promise<{
    port: number;
    close: () => Promise<void>;
  }> {
    const sock = createSocket('udp4');
    const timers = new Set<ReturnType<typeof setTimeout>>();
    sock.on('message', (msg, rinfo) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        try {
          sock.send(buildNxDomain(msg), rinfo.port, rinfo.address);
        } catch {
          // Stub already torn down.
        }
      }, delayMs);
      timers.add(timer);
    });
    return new Promise((resolve, reject) => {
      sock.once('error', reject);
      sock.bind(0, '127.0.0.1', () => {
        sock.removeListener('error', reject);
        resolve({
          port: sock.address().port,
          close: () =>
            new Promise<void>((done) => {
              for (const timer of timers) clearTimeout(timer);
              timers.clear();
              sock.close(() => done());
            }),
        });
      });
    });
  }

  /**
   * Run `body` with vitest's own uncaughtException handlers detached, and
   * report whatever escaped. Without that swap the process-level handler turns
   * a reproduction into a run-level failure instead of a clean assertion.
   */
  async function captureUncaught(body: () => Promise<void>): Promise<unknown[]> {
    const escaped: unknown[] = [];
    const capture = (err: unknown): void => {
      escaped.push(err);
    };
    const prior = process.listeners('uncaughtException');
    process.removeAllListeners('uncaughtException');
    process.on('uncaughtException', capture);
    try {
      await body();
      // Let the late upstream reply land while our handler is still installed.
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      process.removeListener('uncaughtException', capture);
      for (const listener of prior) {
        process.on('uncaughtException', listener as (err: Error) => void);
      }
    }
    return escaped;
  }

  it('does not throw when the upstream reply lands after close()', async () => {
    const upstream = await startStubUpstream(120);
    try {
      const escaped = await captureUncaught(async () => {
        const proxy = await startDnsProxy({
          allowedDomains: ['github.com'],
          upstream: '127.0.0.1',
          upstreamPort: upstream.port,
          log: () => {},
        });
        const client = createSocket('udp4');
        await new Promise<void>((resolve, reject) => {
          client.send(buildQuery('github.com'), proxy.port, '127.0.0.1', (err) =>
            err ? reject(err) : resolve(),
          );
        });
        // Give the forward time to reach the stub, then close mid-flight.
        await new Promise((r) => setTimeout(r, 40));
        await proxy.close();
        client.close();
      });
      expect(escaped).toEqual([]);
    } finally {
      await upstream.close();
    }
  });

  it('close() drops the pending upstream socket and its timeout timer', async () => {
    // A stub that never answers in time: without cleanup the 5s upstream timer
    // (and its socket) outlive close() and keep the event loop alive.
    const upstream = await startStubUpstream(60_000);
    try {
      const proxy = await startDnsProxy({
        allowedDomains: ['github.com'],
        upstream: '127.0.0.1',
        upstreamPort: upstream.port,
        log: () => {},
      });
      const client = createSocket('udp4');
      await new Promise<void>((resolve, reject) => {
        client.send(buildQuery('github.com'), proxy.port, '127.0.0.1', (err) =>
          err ? reject(err) : resolve(),
        );
      });
      await new Promise((r) => setTimeout(r, 40));
      const before = process.getActiveResourcesInfo().length;
      await proxy.close();
      client.close();
      const after = process.getActiveResourcesInfo().length;
      // Server socket + upstream socket + the 5s timer all released.
      expect(after).toBeLessThan(before);
    } finally {
      await upstream.close();
    }
  });
});
