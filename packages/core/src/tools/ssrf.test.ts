import { describe, expect, it } from 'vitest';
import { blockedIpReason, ssrfCheckUrl, type Resolver } from './ssrf.js';

const HARDENED = { allowPrivate: false };

describe('blockedIpReason', () => {
  it('ALWAYS blocks metadata/link-local/unspecified/multicast regardless of policy', () => {
    // Default policy (allowPrivate: true) — these still block.
    expect(blockedIpReason('169.254.169.254')).toMatch(/metadata/); // AWS/GCP/Azure metadata
    expect(blockedIpReason('0.0.0.0')).toMatch(/unspecified/);
    expect(blockedIpReason('224.0.0.1')).toMatch(/multicast/);
    expect(blockedIpReason('fe80::1')).toMatch(/link-local/);
    expect(blockedIpReason('ff02::1')).toMatch(/multicast/);
    expect(blockedIpReason('::')).toMatch(/unspecified/);
  });

  it('allows loopback / RFC-1918 by default (dev-server workflow)', () => {
    expect(blockedIpReason('127.0.0.1')).toBeNull();
    expect(blockedIpReason('10.1.2.3')).toBeNull();
    expect(blockedIpReason('192.168.1.1')).toBeNull();
    expect(blockedIpReason('::1')).toBeNull();
  });

  it('blocks loopback / RFC-1918 / CGNAT / ULA in hardened mode', () => {
    expect(blockedIpReason('127.0.0.1', HARDENED)).toMatch(/loopback/);
    expect(blockedIpReason('10.1.2.3', HARDENED)).toMatch(/private/);
    expect(blockedIpReason('172.16.0.1', HARDENED)).toMatch(/private/);
    expect(blockedIpReason('172.31.255.255', HARDENED)).toMatch(/private/);
    expect(blockedIpReason('192.168.1.1', HARDENED)).toMatch(/private/);
    expect(blockedIpReason('100.64.0.1', HARDENED)).toMatch(/NAT/);
    expect(blockedIpReason('::1', HARDENED)).toMatch(/loopback/);
    expect(blockedIpReason('fc00::1', HARDENED)).toMatch(/unique-local/);
    expect(blockedIpReason('::ffff:10.0.0.1', HARDENED)).toMatch(/private/);
  });

  it('allows genuinely public IPs in both modes', () => {
    expect(blockedIpReason('8.8.8.8')).toBeNull();
    expect(blockedIpReason('8.8.8.8', HARDENED)).toBeNull();
    expect(blockedIpReason('172.32.0.1', HARDENED)).toBeNull(); // just outside 172.16/12
    expect(blockedIpReason('169.253.0.1')).toBeNull(); // just outside link-local
    expect(blockedIpReason('2606:4700:4700::1111')).toBeNull(); // Cloudflare DNS
    expect(blockedIpReason('::ffff:8.8.8.8', HARDENED)).toBeNull();
  });

  it('returns null for non-IP strings (handled as hostnames elsewhere)', () => {
    expect(blockedIpReason('example.com')).toBeNull();
  });
});

describe('ssrfCheckUrl', () => {
  const stub =
    (addrs: string[]): Resolver =>
    async () =>
      addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('blocks literal metadata IP without resolving (default policy)', async () => {
    expect(await ssrfCheckUrl(new URL('http://169.254.169.254/latest/meta-data/'))).toMatch(
      /metadata/,
    );
  });

  it('allows literal loopback by default but blocks it when hardened', async () => {
    expect(await ssrfCheckUrl(new URL('http://127.0.0.1:8080/'))).toBeNull();
    expect(await ssrfCheckUrl(new URL('http://127.0.0.1:8080/'), HARDENED)).toMatch(/loopback/);
    expect(await ssrfCheckUrl(new URL('http://[::1]/'), HARDENED)).toMatch(/loopback/);
  });

  it('always blocks metadata.google.internal; localhost only when hardened', async () => {
    const throwing: Resolver = async () => {
      throw new Error('should not resolve');
    };
    expect(await ssrfCheckUrl(new URL('http://metadata.google.internal/'), {}, throwing)).toMatch(
      /internal/,
    );
    expect(await ssrfCheckUrl(new URL('http://localhost/'), {}, throwing)).toBeNull();
    expect(await ssrfCheckUrl(new URL('http://localhost/'), HARDENED, throwing)).toMatch(
      /internal/,
    );
    expect(await ssrfCheckUrl(new URL('http://foo.local/'), HARDENED, throwing)).toMatch(
      /internal/,
    );
  });

  it('blocks hostnames resolving to the metadata IP even under default policy', async () => {
    const reason = await ssrfCheckUrl(
      new URL('http://evil.example.com/'),
      {},
      stub(['169.254.169.254']),
    );
    expect(reason).toMatch(/resolves to blocked address 169\.254\.169\.254/);
  });

  it('blocks hostnames resolving to a private address only when hardened', async () => {
    expect(
      await ssrfCheckUrl(new URL('http://internal.example.com/'), {}, stub(['10.0.0.5'])),
    ).toBeNull();
    expect(
      await ssrfCheckUrl(new URL('http://internal.example.com/'), HARDENED, stub(['10.0.0.5'])),
    ).toMatch(/resolves to blocked address 10\.0\.0\.5/);
  });

  it('blocks if ANY resolved address is blocked (mixed records)', async () => {
    const reason = await ssrfCheckUrl(
      new URL('http://rebind.example.com/'),
      {},
      stub(['93.184.216.34', '169.254.169.254']),
    );
    expect(reason).toMatch(/link-local/);
  });

  it('allows hostnames that resolve only to public addresses', async () => {
    expect(
      await ssrfCheckUrl(new URL('https://example.com/'), {}, stub(['93.184.216.34'])),
    ).toBeNull();
  });

  it('lets the fetch proceed when resolution fails (network error surfaces later)', async () => {
    const failing: Resolver = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await ssrfCheckUrl(new URL('https://nope.invalid/'), {}, failing)).toBeNull();
  });
});
