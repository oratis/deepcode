import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { buildNxDomain, parseQName, startDnsProxy, type DnsProxyHandle } from './dns-proxy.js';

/** Build a minimal DNS query packet for a single domain. */
function buildQuery(domain: string, txnId = 0x1234): Buffer {
  const labels = domain.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, 'utf8')]));
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
