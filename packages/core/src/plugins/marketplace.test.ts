import { generateKeyPairSync, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addMarketplace,
  fetchIndex,
  fetchRevoked,
  isRevoked,
  loadMarketplaceConfig,
  resolveEntry,
  saveMarketplaceConfig,
  type MarketplaceEntry,
  verifyEntrySignature,
} from './marketplace.js';

function makeSignedEntry(name: string, version: string, sourceHash: string): MarketplaceEntry {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const payload = Buffer.from(`${name}|${version}|${sourceHash}`, 'utf8');
  const sig = sign(null, payload, privateKey);
  return {
    name,
    version,
    sourceHash,
    sigBase64: sig.toString('base64'),
    publisherPubKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    publisher: 'tester',
    downloadUrl: 'https://example.com/x.tgz',
  };
}

describe('verifyEntrySignature', () => {
  it('accepts a well-signed entry', () => {
    const e = makeSignedEntry('demo', '1.0.0', 'abc123');
    expect(verifyEntrySignature(e)).toBe(true);
  });
  it('rejects tampered name', () => {
    const e = makeSignedEntry('demo', '1.0.0', 'abc');
    e.name = 'evil';
    expect(verifyEntrySignature(e)).toBe(false);
  });
  it('rejects tampered version', () => {
    const e = makeSignedEntry('demo', '1.0.0', 'abc');
    e.version = '9.9.9';
    expect(verifyEntrySignature(e)).toBe(false);
  });
  it('rejects tampered sourceHash', () => {
    const e = makeSignedEntry('demo', '1.0.0', 'abc');
    e.sourceHash = 'evil-hash';
    expect(verifyEntrySignature(e)).toBe(false);
  });
  it('rejects garbage signature', () => {
    const e = makeSignedEntry('demo', '1.0.0', 'abc');
    e.sigBase64 = 'not-a-real-signature';
    expect(verifyEntrySignature(e)).toBe(false);
  });
});

describe('isRevoked', () => {
  it('matches by name+version+sourceHash', () => {
    const e = makeSignedEntry('demo', '1.0.0', 'h1');
    expect(
      isRevoked(e, {
        version: '1',
        entries: [{ name: 'demo', version: '1.0.0', sourceHash: 'h1' }],
      }),
    ).toBe(true);
  });
  it('does NOT match on different hash (e.g. re-released)', () => {
    const e = makeSignedEntry('demo', '1.0.0', 'h1');
    expect(
      isRevoked(e, {
        version: '1',
        entries: [{ name: 'demo', version: '1.0.0', sourceHash: 'h2' }],
      }),
    ).toBe(false);
  });
});

describe('fetchIndex / fetchRevoked / resolveEntry', () => {
  let server: Server;
  let baseUrl: string;
  let index: { version: string; entries: MarketplaceEntry[] };
  let revoked: { version: string; entries: unknown[] } = { version: '1', entries: [] };
  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === '/index.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(index));
        return;
      }
      if (req.url === '/revoked.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(revoked));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/index.json`;
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('fetches an index and returns entries', async () => {
    const e = makeSignedEntry('demo', '1.0.0', 'h');
    index = { version: '1', entries: [e] };
    const r = await fetchIndex(baseUrl);
    expect(r.entries).toHaveLength(1);
  });

  it('resolveEntry picks the highest version + verifies sig + checks revoked', async () => {
    const e1 = makeSignedEntry('demo', '1.0.0', 'h-old');
    const e2 = makeSignedEntry('demo', '2.0.1', 'h-new');
    index = { version: '1', entries: [e1, e2] };
    revoked = { version: '1', entries: [] };
    const picked = await resolveEntry({ marketplaceUrl: baseUrl, name: 'demo' });
    expect(picked.version).toBe('2.0.1');
  });

  it('resolveEntry honors explicit version', async () => {
    const e1 = makeSignedEntry('demo', '1.0.0', 'h1');
    const e2 = makeSignedEntry('demo', '2.0.0', 'h2');
    index = { version: '1', entries: [e1, e2] };
    revoked = { version: '1', entries: [] };
    const picked = await resolveEntry({ marketplaceUrl: baseUrl, name: 'demo', version: '1.0.0' });
    expect(picked.version).toBe('1.0.0');
  });

  it('resolveEntry refuses revoked', async () => {
    const e = makeSignedEntry('demo', '1.0.0', 'h-bad');
    index = { version: '1', entries: [e] };
    revoked = {
      version: '1',
      entries: [{ name: 'demo', version: '1.0.0', sourceHash: 'h-bad' }],
    };
    await expect(resolveEntry({ marketplaceUrl: baseUrl, name: 'demo' })).rejects.toThrow(/revocation/i);
  });

  it('resolveEntry refuses tampered entry', async () => {
    const e = makeSignedEntry('demo', '1.0.0', 'h');
    e.sourceHash = 'tampered-hash';
    index = { version: '1', entries: [e] };
    revoked = { version: '1', entries: [] };
    await expect(resolveEntry({ marketplaceUrl: baseUrl, name: 'demo' })).rejects.toThrow(/Signature/);
  });

  it('fetchRevoked treats 404 as empty list', async () => {
    // Replace the server with one that 404s revoked.json
    await new Promise<void>((r) => server.close(() => r()));
    server = createServer((req, res) => {
      if (req.url === '/index.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ version: '1', entries: [] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${addr.port}/index.json`;
    const r = await fetchRevoked(url);
    expect(r.entries).toEqual([]);
  });
});

describe('marketplace config', () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-mp-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('roundtrips loadMarketplaceConfig / saveMarketplaceConfig', async () => {
    const initial = await loadMarketplaceConfig(home);
    expect(initial).toEqual({ marketplaces: {} });
    await saveMarketplaceConfig({ marketplaces: { 'https://x.example/index.json': {} } }, home);
    const after = await loadMarketplaceConfig(home);
    expect(after.marketplaces).toHaveProperty('https://x.example/index.json');
  });
});

describe('addMarketplace', () => {
  let server: Server;
  let baseUrl: string;
  let home: string;
  beforeEach(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: '1', entries: [] }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/index.json`;
    home = await mkdtemp(join(tmpdir(), 'dc-mp-add-'));
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(home, { recursive: true, force: true });
  });
  it('saves URL after fetching the index', async () => {
    const cfg = await addMarketplace(baseUrl, { home });
    expect(cfg.marketplaces).toHaveProperty(baseUrl);
  });
});
