import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDuckDuckGoHtml, WebSearchTool } from './web-search.js';

const SAMPLE_HTML = `
<html><body>
<div class="result">
  <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ffirst&rut=abc">Example First</a></h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ffirst">First snippet text &amp; more</a>
</div>
<div class="result">
  <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fsecond">Example Second</a></h2>
  <div class="result__snippet">Second snippet</div>
</div>
</body></html>
`;

function startServer(body: string, status = 200): Promise<{ server: Server; url: string }> {
  return new Promise((res) => {
    const server = createServer((_req, response) => {
      response.statusCode = status;
      response.setHeader('content-type', 'text/html');
      response.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      res({ server, url: `http://127.0.0.1:${addr.port}/?q={q}` });
    });
  });
}

describe('parseDuckDuckGoHtml', () => {
  it('extracts title, URL, and snippet from DDG markup', () => {
    const hits = parseDuckDuckGoHtml(SAMPLE_HTML);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.title).toBe('Example First');
    expect(hits[0]?.url).toBe('https://example.com/first');
    expect(hits[0]?.snippet).toBe('First snippet text & more');
    expect(hits[1]?.title).toBe('Example Second');
    expect(hits[1]?.url).toBe('https://example.org/second');
    expect(hits[1]?.snippet).toBe('Second snippet');
  });

  it('returns [] on garbage HTML', () => {
    expect(parseDuckDuckGoHtml('<html>no results</html>')).toEqual([]);
  });
});

describe('WebSearchTool', () => {
  let server: Server | null = null;
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    delete process.env['DEEPCODE_WEBSEARCH_URL_TEMPLATE'];
  });
  beforeEach(() => {
    server = null;
  });

  it('returns formatted hits from a stubbed backend', async () => {
    const s = await startServer(SAMPLE_HTML);
    server = s.server;
    process.env['DEEPCODE_WEBSEARCH_URL_TEMPLATE'] = s.url;
    const result = await WebSearchTool.execute({ query: 'example' }, { cwd: process.cwd() });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Example First');
    expect(result.content).toContain('https://example.com/first');
    expect((result.data as { hits: unknown[] }).hits).toHaveLength(2);
  });

  it('honors limit', async () => {
    const s = await startServer(SAMPLE_HTML);
    server = s.server;
    process.env['DEEPCODE_WEBSEARCH_URL_TEMPLATE'] = s.url;
    const result = await WebSearchTool.execute(
      { query: 'example', limit: 1 },
      { cwd: process.cwd() },
    );
    const data = result.data as { hits: unknown[] };
    expect(data.hits).toHaveLength(1);
  });

  it('returns "no results" message when nothing matches', async () => {
    const s = await startServer('<html>nothing here</html>');
    server = s.server;
    process.env['DEEPCODE_WEBSEARCH_URL_TEMPLATE'] = s.url;
    const result = await WebSearchTool.execute({ query: 'foo' }, { cwd: process.cwd() });
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatch(/No results/i);
  });

  it('rejects empty query', async () => {
    const result = await WebSearchTool.execute({ query: '' }, { cwd: process.cwd() });
    expect(result.isError).toBe(true);
  });

  it('returns error when backend 5xx', async () => {
    const s = await startServer('boom', 500);
    server = s.server;
    process.env['DEEPCODE_WEBSEARCH_URL_TEMPLATE'] = s.url;
    const result = await WebSearchTool.execute({ query: 'x' }, { cwd: process.cwd() });
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/500/);
  });
});
