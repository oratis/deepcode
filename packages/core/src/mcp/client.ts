// MCP client — wraps @modelcontextprotocol/sdk for stdio transport.
// Spec: docs/DEVELOPMENT_PLAN.md §3.3
// M3c: stdio transport only. http/sse + OAuth + headersHelper + Elicitation
// in M3c-ext (next PR).

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig } from '../config/types.js';
import type { ToolDefinition, ToolHandler, ToolResult } from '../types.js';

export interface McpToolMeta {
  /** Original tool name as exposed by the MCP server. */
  serverToolName: string;
  /** Server name (key in settings.mcpServers). */
  serverName: string;
}

export interface McpClientHandle {
  serverName: string;
  client: Client;
  transport: StdioClientTransport;
  tools: ToolHandler[];
  close(): Promise<void>;
}

/**
 * Connect to one MCP server via stdio. Returns a handle containing the
 * registered tools (qualified as `mcp__<server>__<tool>`).
 *
 * Caller is responsible for calling `handle.close()` on shutdown.
 */
export async function connectMcpServer(
  serverName: string,
  config: McpServerConfig,
): Promise<McpClientHandle> {
  if (!config.command) {
    throw new Error(`MCP server "${serverName}" must specify a command (stdio transport)`);
  }
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: { ...(process.env as Record<string, string>), ...(config.env ?? {}) },
  });

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
