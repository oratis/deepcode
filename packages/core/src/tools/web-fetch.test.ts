import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebFetchTool } from './web-fetch.js';

function startServer(
  handler: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => void,
): Promise<{ server: Server; url: string }> {
  return new Promise((res) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      res({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

describe('WebFetchTool', () => {
  let server: Server | null = null;
  beforeEach(() => {
    server = null;
  });
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
  });

  it('returns body text on 200', async () => {
    const s = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.end('hello world');
    });
    server = s.server;
    const result = await WebFetchTool.execute({ url: s.url }, { cwd: process.cwd() });
    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('hello world');
    expect((result.data as { status: number }).status).toBe(200);
  });

  it('marks isError on 5xx but still returns body', async () => {
    const s = await startServer((_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });
    server = s.server;
    const result = await WebFetchTool.execute({ url: s.url }, { cwd: process.cwd() });
    expect(result.isError).toBe(true);
    expect(result.content).toBe('boom');
  });

  it('rejects non-http URL', async () => {
    const result = await WebFetchTool.execute(
      { url: 'file:///etc/hostname' },
      { cwd: process.cwd() },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/only http/i);
  });

  it('rejects invalid URL', async () => {
    const result = await WebFetchTool.execute({ url: 'not-a-url' }, { cwd: process.cwd() });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/invalid URL/i);
  });

  it('caps oversized responses via content-length', async () => {
    process.env['DEEPCODE_WEBFETCH_MAX_BYTES'] = '10';
    const s = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-length', '1000');
      res.setHeader('content-type', 'text/plain');
      res.end('x'.repeat(1000));
    });
    server = s.server;
    try {
      const result = await WebFetchTool.execute({ url: s.url }, { cwd: process.cwd() });
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/too large/i);
    } finally {
      delete process.env['DEEPCODE_WEBFETCH_MAX_BYTES'];
    }
  });

  it('caps oversized responses when streaming with no content-length', async () => {
    process.env['DEEPCODE_WEBFETCH_MAX_BYTES'] = '50';
    const s = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      // Chunked-style: no content-length set.
      res.write('a'.repeat(40));
      res.write('b'.repeat(40));
      res.end();
    });
    server = s.server;
    try {
      const result = await WebFetchTool.execute({ url: s.url }, { cwd: process.cwd() });
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/stream cap/i);
    } finally {
      delete process.env['DEEPCODE_WEBFETCH_MAX_BYTES'];
    }
  });

  it('honors abort signal', async () => {
    const s = await startServer((_req, res) => {
      // Never respond — let abort fire
      setTimeout(() => {
        try {
          res.end('late');
        } catch {
          /* ignore */
        }
      }, 5000);
    });
    server = s.server;
    const ctrl = new AbortController();
    const p = WebFetchTool.execute({ url: s.url }, { cwd: process.cwd(), signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 100);
    const result = await p;
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/aborted/i);
  }, 8000);
});
