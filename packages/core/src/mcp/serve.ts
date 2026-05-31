// `deepcode mcp serve` — expose DeepCode's built-in tools as an MCP server over
// stdio, so other MCP clients (Claude Desktop, another DeepCode, etc.) can call
// Read/Write/Edit/Bash/Grep/Glob/… in a project directory.
// Spec: docs/DEVELOPMENT_PLAN.md §3.3 (mcp serve)
//
// We expose only STATELESS tools. The interactive / host-coupled tools need
// context an MCP peer can't provide (AskUserQuestion → askUser callback;
// EnterPlanMode/ExitPlanMode → modeSignal; Task → runSubAgent; worktree tools
// mutate the live ctx; Cron* manage a local scheduler) so they're excluded.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BUILTIN_TOOLS } from '../tools/registry.js';
import type { ToolContext, ToolHandler } from '../types.js';

/** Tools that can't run statelessly over MCP (need host-interactive context). */
export const MCP_SERVE_EXCLUDE = new Set<string>([
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'EnterWorktree',
  'ExitWorktree',
  'Task',
  'CronCreate',
  'CronList',
  'CronDelete',
]);

/** The subset of `tools` that is safe to expose over an MCP stdio server. */
export function mcpServableTools(tools: ToolHandler[] = BUILTIN_TOOLS): ToolHandler[] {
  return tools.filter((t) => !MCP_SERVE_EXCLUDE.has(t.name));
}

export interface BuildMcpServerOpts {
  /** Project directory tools resolve relative paths against. */
  cwd: string;
  /** Override the served tool set (default: stateless BUILTIN_TOOLS). */
  tools?: ToolHandler[];
  name?: string;
  version?: string;
  /** Abort signal propagated into each tool's ToolContext. */
  signal?: AbortSignal;
  /** Optional sandbox config forwarded to the Bash tool. */
  sandboxConfig?: ToolContext['sandboxConfig'];
}

/**
 * Build (but don't connect) an MCP `Server` that lists + executes the given
 * tools. Returned unconnected so callers can attach any transport — stdio in
 * production, an in-memory pair in tests.
 */
export function buildMcpServer(opts: BuildMcpServerOpts): Server {
  const tools = opts.tools ?? mcpServableTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const server = new Server(
    { name: opts.name ?? 'deepcode', version: opts.version ?? '0.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.definition.name,
      description: t.definition.description,
      inputSchema: t.definition.inputSchema as { type: 'object' },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    const ctx: ToolContext = {
      cwd: opts.cwd,
      signal: opts.signal,
      sandboxConfig: opts.sandboxConfig,
    };
    try {
      const result = await tool.execute(
        (req.params.arguments ?? {}) as Record<string, unknown>,
        ctx,
      );
      return {
        content: [{ type: 'text' as const, text: result.content }],
        isError: result.isError ?? false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: (err as Error).message }],
        isError: true,
      };
    }
  });

  return server;
}

export interface ServeMcpStdioOpts extends BuildMcpServerOpts {
  /** Called once the transport is connected (log to stderr, never stdout). */
  onReady?: (toolNames: string[]) => void;
}

/**
 * Build the server and serve it over stdio. Resolves when the transport closes
 * (peer disconnects / stdin EOF). stdout is the JSON-RPC channel — callers MUST
 * NOT write anything else to it.
 */
export async function serveMcpOverStdio(opts: ServeMcpStdioOpts): Promise<void> {
  const tools = opts.tools ?? mcpServableTools();
  const server = buildMcpServer({ ...opts, tools });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  opts.onReady?.(tools.map((t) => t.name));
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // Peer disconnect / stdin EOF.
    transport.onclose = finish;
    // SIGINT (or test abort): close the transport so stdin listeners detach.
    const stop = () =>
      void server
        .close()
        .catch(() => undefined)
        .finally(finish);
    if (opts.signal?.aborted) stop();
    else opts.signal?.addEventListener('abort', stop, { once: true });
  });
}
