// WebFetch tool — fetch a URL and return its body as text.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 (M3c-rest, plan §3.15.4)
//
// Safety:
//   · Caps response at WEBFETCH_MAX_BYTES (default 5 MiB).
//   · Honors AbortSignal from agent loop.
//   · Strips request to HEAD/GET only — no POST from this tool (use Bash + curl
//     if a write is truly needed; permission gate catches that).
//   · No redirect-following beyond fetch's default; if host policy needs custom
//     allowlists, wire through ctx (future work).

import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface FetchInput {
  url: string;
  /** Optional prompt for the model — surfaced in response metadata for traceability. */
  prompt?: string;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export const WebFetchTool: ToolHandler = {
  name: 'WebFetch',
  definition: {
    name: 'WebFetch',
    description:
      'Fetch a URL via GET and return its body as text. Capped at 5 MiB. Read-only — for writes, use Bash + curl with an explicit permission grant.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute http(s) URL.',
        },
        prompt: {
          type: 'string',
          description: 'Optional intent — recorded in the result metadata.',
        },
      },
      required: ['url'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as FetchInput;
    if (!input?.url || typeof input.url !== 'string') {
      return { content: 'Error: url is required (string).', isError: true };
    }
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      return { content: `Error: invalid URL: ${input.url}`, isError: true };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        content: `Error: only http(s) URLs supported (got ${parsed.protocol}).`,
        isError: true,
      };
    }

    const maxBytes = Number(process.env['DEEPCODE_WEBFETCH_MAX_BYTES'] ?? DEFAULT_MAX_BYTES);
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const linkedAbort = () => controller.abort();
    if (ctx.signal) ctx.signal.addEventListener('abort', linkedAbort);

    try {
      const res = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'DeepCode/0.1 (+https://github.com/oratis/deepcode)' },
        signal: controller.signal,
      });
      const status = res.status;
      const contentType = res.headers.get('content-type') ?? '';
      const contentLength = Number(res.headers.get('content-length') ?? 0);
      if (contentLength && contentLength > maxBytes) {
        return {
          content: `Error: response too large (${contentLength} > ${maxBytes} bytes).`,
          isError: true,
          data: { url: parsed.toString(), status, contentLength },
        };
      }
      // Stream body with a hard byte cap (content-length may be missing for chunked).
      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > maxBytes) {
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            return {
              content: `Error: response exceeded ${maxBytes} bytes (stream cap).`,
              isError: true,
              data: { url: parsed.toString(), status, partialBytes: received },
            };
          }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks).toString('utf8');
      return {
        content: body,
        data: {
          url: parsed.toString(),
          status,
          contentType,
          bytes: received,
          prompt: input.prompt,
        },
        isError: !res.ok,
      };
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        return { content: `Error: fetch aborted (timeout ${TIMEOUT_MS}ms or signal).`, isError: true };
      }
      return { content: `Error fetching ${parsed.toString()}: ${e.message}`, isError: true };
    } finally {
      clearTimeout(tid);
      if (ctx.signal) ctx.signal.removeEventListener('abort', linkedAbort);
    }
  },
};
