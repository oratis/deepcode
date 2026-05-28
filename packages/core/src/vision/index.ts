// Image input subsystem — abstraction for sending images alongside text
// to a multimodal model. Spec: docs/DEVELOPMENT_PLAN.md §v1.1 (image input)
//
// DeepSeek doesn't ship a vision model as of v1; this scaffold defines the
// interface so the agent loop can carry image content blocks once a vision
// provider is wired (Qwen-VL via OpenRouter, GPT-4o via OpenAI-compat, etc.).
//
// The shape mirrors text streaming — provider implementations decode an
// image_url or base64 block into whatever shape their API wants.

import { promises as fs } from 'node:fs';
import { extname } from 'node:path';

export interface ImageContentBlock {
  type: 'image';
  /** One of: data URL, file path, or http(s) URL. */
  source: string;
  /** Optional alt-text — useful for accessibility + provider hints. */
  altText?: string;
}

export interface VisionProvider {
  readonly name: string;
  /** Whether this provider can handle the image (e.g. some only accept JPEG). */
  supports(block: ImageContentBlock): boolean;
  /**
   * Convert an ImageContentBlock to the provider-specific shape. Most APIs
   * accept either base64 data URLs or remote URLs.
   */
  encode(block: ImageContentBlock): Promise<ProviderImagePayload>;
}

/** What the provider's chat API wants for an image attachment. */
export interface ProviderImagePayload {
  /** Provider-native shape. The agent loop treats this opaquely. */
  payload: unknown;
  /** Provider-reported size in bytes (for cost accounting). */
  byteSize: number;
}

/**
 * Resolve any of (data URL | file path | http URL) into a normalized
 * { contentType, base64, byteSize } tuple. Used by providers that want
 * to upload as base64 vs link directly.
 */
export async function loadImage(block: ImageContentBlock): Promise<{
  contentType: string;
  base64: string;
  byteSize: number;
}> {
  const src = block.source;
  if (src.startsWith('data:')) {
    return parseDataUrl(src);
  }
  if (/^https?:/i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? guessContentType(src);
    return { contentType: ct, base64: buf.toString('base64'), byteSize: buf.length };
  }
  // Local file
  const buf = await fs.readFile(src);
  return {
    contentType: guessContentType(src),
    base64: buf.toString('base64'),
    byteSize: buf.length,
  };
}

export function parseDataUrl(dataUrl: string): {
  contentType: string;
  base64: string;
  byteSize: number;
} {
  const m = /^data:([^;,]+)(?:;([^,]+))?,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('malformed data URL');
  const [, contentType = 'application/octet-stream', encoding, body = ''] = m;
  if (encoding !== 'base64') {
    // URL-encoded text → re-encode as base64
    const buf = Buffer.from(decodeURIComponent(body), 'utf8');
    return { contentType, base64: buf.toString('base64'), byteSize: buf.length };
  }
  const buf = Buffer.from(body, 'base64');
  return { contentType, base64: body, byteSize: buf.length };
}

export function guessContentType(path: string): string {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Stub provider — used when no vision model is configured. Errors on
// supports() so the agent loop skips image content blocks instead of
// silently dropping them.
// ──────────────────────────────────────────────────────────────────────────

export class StubVisionProvider implements VisionProvider {
  readonly name = 'stub';
  supports(): boolean {
    return false;
  }
  async encode(): Promise<ProviderImagePayload> {
    throw new Error('no vision provider configured');
  }
}

// ──────────────────────────────────────────────────────────────────────────
// OpenAI-compatible provider (works with most multimodal endpoints that
// implement the OpenAI chat API — Qwen-VL via OpenRouter, GPT-4o, etc.)
// ──────────────────────────────────────────────────────────────────────────

export class OpenAICompatVisionProvider implements VisionProvider {
  readonly name = 'openai-compat';
  /** Max image bytes the provider accepts; default 20 MB. */
  maxBytes = 20 * 1024 * 1024;

  supports(block: ImageContentBlock): boolean {
    // Any image type — let the upstream decide.
    return block.type === 'image';
  }

  async encode(block: ImageContentBlock): Promise<ProviderImagePayload> {
    const img = await loadImage(block);
    if (img.byteSize > this.maxBytes) {
      throw new Error(`image too large: ${img.byteSize} > ${this.maxBytes} bytes`);
    }
    const dataUrl = `data:${img.contentType};base64,${img.base64}`;
    return {
      payload: {
        type: 'image_url',
        image_url: { url: dataUrl, detail: 'auto' },
      },
      byteSize: img.byteSize,
    };
  }
}
