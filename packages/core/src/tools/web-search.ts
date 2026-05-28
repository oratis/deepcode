// WebSearch tool — query the web and return top-N result links + titles + snippets.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 (M3c-rest, plan §3.15.4)
//
// Approach:
//   · Default backend: DuckDuckGo HTML endpoint (no API key required). Parsed
//     with a tolerant regex; sufficient for "give the agent a few links to fetch".
//   · Pluggable via `DEEPCODE_WEBSEARCH_URL_TEMPLATE` (e.g. for self-hosted SearXNG).
//   · Caps to N=8 results.
//
// Caveats acknowledged:
//   · DDG's markup changes; we parse defensively but tests stub the HTML.
//   · No image / news verticals — just web links.

import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface SearchInput {
  query: string;
  limit?: number;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

const DEFAULT_LIMIT = 8;
const TIMEOUT_MS = 20_000;
const DEFAULT_TEMPLATE = 'https://duckduckgo.com/html/?q={q}';

export const WebSearchTool: ToolHandler = {
  name: 'WebSearch',
  definition: {
    name: 'WebSearch',
    description:
      'Search the web and return up to 8 results (title + URL + snippet). Default backend: DuckDuckGo HTML. Set DEEPCODE_WEBSEARCH_URL_TEMPLATE to point at a self-hosted SearXNG.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        limit: { type: 'number', description: 'Max results (1-8, default 8).' },
      },
      required: ['query'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as SearchInput;
    if (!input?.query || typeof input.query !== 'string') {
      return { content: 'Error: query is required (string).', isError: true };
    }
    const limit = Math.max(1, Math.min(DEFAULT_LIMIT, input.limit ?? DEFAULT_LIMIT));
    const template = process.env['DEEPCODE_WEBSEARCH_URL_TEMPLATE'] ?? DEFAULT_TEMPLATE;
    const url = template.replace('{q}', encodeURIComponent(input.query));

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const linkedAbort = () => controller.abort();
    if (ctx.signal) ctx.signal.addEventListener('abort', linkedAbort);

    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'DeepCode/0.1 (+https://github.com/oratis/deepcode)' },
        signal: controller.signal,
      });
      if (!res.ok) {
        return { content: `Error: search backend returned ${res.status}`, isError: true };
      }
      const html = await res.text();
      const hits = parseDuckDuckGoHtml(html).slice(0, limit);
      if (hits.length === 0) {
        return {
          content: `No results for "${input.query}".`,
          data: { hits: [], backend: url },
        };
      }
      const formatted = hits
        .map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`)
        .join('\n\n');
      return {
        content: formatted,
        data: { hits, backend: url, query: input.query },
      };
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        return { content: `Error: search aborted (timeout ${TIMEOUT_MS}ms or signal).`, isError: true };
      }
      return { content: `Error: ${e.message}`, isError: true };
    } finally {
      clearTimeout(tid);
      if (ctx.signal) ctx.signal.removeEventListener('abort', linkedAbort);
    }
  },
};

/**
 * Parse DDG's HTML result page. The markup uses `result__a` for titles and
 * `result__snippet` for descriptions. We're permissive: any reasonable a-tag
 * containing href= within a result block counts.
 */
export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  // Match <a class="result__a" href="...">title</a> ... <a class="result__snippet">snippet</a>
  const blockRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const rawUrl = m[1] ?? '';
    const url = unwrapDdgRedirect(decodeHtml(rawUrl));
    const title = stripTags(decodeHtml(m[2] ?? '')).trim();
    const snippet = stripTags(decodeHtml(m[3] ?? m[4] ?? '')).trim();
    if (url && title) {
      hits.push({ title, url, snippet });
    }
  }
  return hits;
}

function unwrapDdgRedirect(url: string): string {
  // DDG wraps results as `//duckduckgo.com/l/?uddg=<encoded>&...`
  try {
    let absolute = url;
    if (absolute.startsWith('//')) absolute = 'https:' + absolute;
    if (!/^https?:/i.test(absolute)) return url;
    const u = new URL(absolute);
    const real = u.searchParams.get('uddg');
    if (real) return decodeURIComponent(real);
    return absolute;
  } catch {
    return url;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
