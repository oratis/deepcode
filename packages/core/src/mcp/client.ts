// MCP client — wraps @modelcontextprotocol/sdk. Supports stdio, Streamable HTTP,
// and HTTP+SSE transports, with static + dynamic (headersHelper) auth headers.
// Spec: docs/DEVELOPMENT_PLAN.md §3.3
//
// NOTE: full OAuth (authorization-code browser flow via the SDK's authProvider)
// is a separate follow-up — static bearer/headers + headersHelper cover the
// common token-auth case today. The transports already accept an authProvider,
// so wiring OAuth later is additive.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from '../config/types.js';
import type { ToolDefinition, ToolHandler, ToolResult } from '../types.js';

const execFileAsync = promisify(execFile);

export interface McpToolMeta {
  /** Original tool name as exposed by the MCP server. */
  serverToolName: string;
  /** Server name (key in settings.mcpServers). */
  serverName: string;
}

export type McpTransportKind = 'stdio' | 'http' | 'sse';

export interface McpClientHandle {
  serverName: string;
  client: Client;
  transport: Transport;
  /** Which transport this connection uses. */
  transportKind: McpTransportKind;
  tools: ToolHandler[];
  close(): Promise<void>;
}

/**
 * Decide the transport for a server config:
 *   - explicit `transport` wins;
 *   - else `command` → stdio, `url` → http (Streamable HTTP, the modern default);
 *   - else null (caller errors).
 */
export function pickTransportKind(config: McpServerConfig): McpTransportKind | null {
  if (config.transport) return config.transport;
  if (config.command) return 'stdio';
  if (config.url) return 'http';
  return null;
}

/**
 * Parse a headersHelper's stdout into HTTP headers. Accepts either a JSON object
 * (`{"Authorization":"Bearer x"}`) or `Key: Value` lines.
 */
export function parseHelperOutput(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  const trimmed = stdout.trim();
  if (!trimmed) return out;
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k] = String(v);
      return out;
    }
  } catch {
    /* not JSON — fall through to line parsing */
  }
  for (const line of trimmed.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Merge static `headers` with the dynamic `headersHelper` output (helper wins). */
async function resolveAuthHeaders(config: McpServerConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  if (config.headersHelper) {
    try {
      const { stdout } = await execFileAsync('/bin/sh', ['-c', config.headersHelper], {
        timeout: 10_000,
      });
      Object.assign(headers, parseHelperOutput(stdout));
    } catch (err) {
      throw new Error(`headersHelper failed: ${(err as Error).message}`);
    }
  }
  return headers;
}

async function buildTransport(
  serverName: string,
  config: McpServerConfig,
  kind: McpTransportKind,
): Promise<Transport> {
  if (kind === 'stdio') {
    if (!config.command) {
      throw new Error(`MCP server "${serverName}" (stdio) must specify a command`);
    }
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
    });
  }
  // http / sse
  if (!config.url) {
    throw new Error(`MCP server "${serverName}" (${kind}) must specify a url`);
  }
  const url = new URL(config.url);
  const headers = await resolveAuthHeaders(config);
  const requestInit: RequestInit = Object.keys(headers).length > 0 ? { headers } : {};
  return kind === 'sse'
    ? new SSEClientTransport(url, { requestInit })
    : new StreamableHTTPClientTransport(url, { requestInit });
}

/**
 * Connect to one MCP server (stdio / http / sse). Returns a handle containing
 * the registered tools (qualified as `mcp__<server>__<tool>`).
 * Caller is responsible for calling `handle.close()` on shutdown.
 */
export async function connectMcpServer(
  serverName: string,
  config: McpServerConfig,
): Promise<McpClientHandle> {
  const kind = pickTransportKind(config);
  if (!kind) {
    throw new Error(
      `MCP server "${serverName}" must specify a command (stdio) or a url (http/sse)`,
    );
  }
  const transport = await buildTransport(serverName, config, kind);
  const client = new Client({ name: 'deepcode', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);

  // List the tools the server exposes
  const listed = await client.listTools();
  const tools: ToolHandler[] = listed.tools.map((t) => {
    const qualified = `mcp__${serverName}__${t.name}`;
    const def: ToolDefinition = {
      name: qualified,
      description: t.description ?? `(MCP tool from ${serverName})`,
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    };
    return {
      name: qualified,
      definition: def,
      async execute(input: Record<string, unknown>): Promise<ToolResult> {
        try {
          const result = (await client.callTool({
            name: t.name,
            arguments: input,
          })) as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
          // MCP returns { content: [{type:'text', text:'...'}, ...] }
          const textParts =
            (result.content ?? [])
              .filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('\n') || '';
          return {
            content: textParts || '(MCP tool returned no text content)',
            isError: result.isError === true,
            data: { serverName, serverToolName: t.name },
          };
        } catch (err) {
          return {
            content: `MCP call failed: ${(err as Error).message}`,
            isError: true,
          };
        }
      },
    };
  });

  return {
    serverName,
    client,
    transport,
    transportKind: kind,
    tools,
    async close() {
      await client.close();
    },
  };
}

/**
 * Connect to many MCP servers — used at session start by the CLI.
 * Failures are individual (one bad server doesn't kill the rest).
 */
export interface ConnectAllResult {
  handles: McpClientHandle[];
  errors: Array<{ serverName: string; error: string }>;
}

export async function connectAllMcpServers(
  servers: Record<string, McpServerConfig>,
  opts: { enabledOnly?: string[]; disabled?: string[] } = {},
): Promise<ConnectAllResult> {
  const handles: McpClientHandle[] = [];
  const errors: Array<{ serverName: string; error: string }> = [];
  const enabled = opts.enabledOnly ? new Set(opts.enabledOnly) : null;
  const disabled = new Set(opts.disabled ?? []);

  for (const [name, cfg] of Object.entries(servers)) {
    if (enabled && !enabled.has(name)) continue;
    if (disabled.has(name)) continue;
    try {
      const handle = await connectMcpServer(name, cfg);
      handles.push(handle);
    } catch (err) {
      errors.push({ serverName: name, error: (err as Error).message });
    }
  }
  return { handles, errors };
}

export async function closeAllMcpServers(handles: McpClientHandle[]): Promise<void> {
  await Promise.allSettled(handles.map((h) => h.close()));
}
