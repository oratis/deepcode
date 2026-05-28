import { promises as fs } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  guessContentType,
  loadImage,
  OpenAICompatVisionProvider,
  parseDataUrl,
  StubVisionProvider,
} from './index.js';

describe('guessContentType', () => {
  it.each([
    ['/x/y.png', 'image/png'],
    ['/x/y.jpg', 'image/jpeg'],
    ['/x/y.jpeg', 'image/jpeg'],
    ['/x/y.webp', 'image/webp'],
    ['/x/y.gif', 'image/gif'],
    ['/x/y.svg', 'image/svg+xml'],
    ['/x/y.bin', 'application/octet-stream'],
  ])('%s → %s', (p, ct) => expect(guessContentType(p)).toBe(ct));
});

describe('parseDataUrl', () => {
  it('decodes base64 data URL', () => {
    const r = parseDataUrl('data:image/png;base64,iVBORw0KGgo=');
    expect(r.contentType).toBe('image/png');
    expect(r.base64).toBe('iVBORw0KGgo=');
    expect(r.byteSize).toBeGreaterThan(0);
  });
  it('decodes plain (non-base64) data URL', () => {
    const r = parseDataUrl('data:text/plain,hello%20world');
    expect(r.contentType).toBe('text/plain');
    expect(Buffer.from(r.base64, 'base64').toString('utf8')).toBe('hello world');
  });
  it('throws on malformed', () => {
    expect(() => parseDataUrl('not-a-data-url')).toThrow();
  });
});

describe('loadImage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dc-vision-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a local file', async () => {
    const path = join(dir, 'x.png');
    await fs.writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
    const r = await loadImage({ type: 'image', source: path });
    expect(r.contentType).toBe('image/png');
    expect(r.byteSize).toBe(4);
  });

  it('handles a data URL', async () => {
    const r = await loadImage({
      type: 'image',
      source: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(r.contentType).toBe('image/png');
  });

  it('fetches a remote URL', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(Buffer.from([0xff, 0xd8, 0xff])); // JPEG magic
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as AddressInfo;
    try {
      const r = await loadImage({
        type: 'image',
        source: `http://127.0.0.1:${addr.port}/x.jpg`,
      });
      expect(r.contentType).toBe('image/jpeg');
      expect(r.byteSize).toBe(3);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });

  it('throws on remote 4xx', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address() as AddressInfo;
    try {
      await expect(
        loadImage({ type: 'image', source: `http://127.0.0.1:${addr.port}/x.jpg` }),
      ).rejects.toThrow(/404/);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });
});

describe('StubVisionProvider', () => {
  it('reports no support and throws on encode', async () => {
    const p = new StubVisionProvider();
    expect(p.supports()).toBe(false);
    await expect(p.encode()).rejects.toThrow(/no vision/);
  });
});

describe('OpenAICompatVisionProvider', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dc-vis-prov-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('encodes a local file to an image_url payload with a data URL', async () => {
    const path = join(dir, 'pic.png');
    await fs.writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const p = new OpenAICompatVisionProvider();
    const out = await p.encode({ type: 'image', source: path });
    expect(out.byteSize).toBe(4);
    const pl = out.payload as { type: string; image_url: { url: string; detail: string } };
    expect(pl.type).toBe('image_url');
    expect(pl.image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(pl.image_url.detail).toBe('auto');
  });

  it('throws when image exceeds maxBytes', async () => {
    const p = new OpenAICompatVisionProvider();
    p.maxBytes = 2; // ridiculously low
    const path = join(dir, 'big.png');
    await fs.writeFile(path, Buffer.alloc(100));
    await expect(p.encode({ type: 'image', source: path })).rejects.toThrow(/too large/);
  });

  it('supports all image blocks (provider decides upstream)', () => {
    const p = new OpenAICompatVisionProvider();
    expect(p.supports({ type: 'image', source: 'x' })).toBe(true);
  });
});
