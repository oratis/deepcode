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
import { dispatchToolCall } from '../harness/tool-dispatcher.js';
import { BUILTIN_TOOLS } from '../tools/registry.js';
import type { FileContract } from '../config/file-contract.js';
import type { AutoModeConfig, PermissionRules } from '../config/types.js';
import type { HookDispatcher } from '../hooks/index.js';
import type { Mode, ToolContext, ToolHandler } from '../types.js';

/** The verdict for one MCP tool call. `allowed: false` is returned to the peer. */
export interface McpGateVerdict {
  allowed: boolean;
  reason: string;
}

export type McpToolGate = (req: {
  tool: string;
  input: Record<string, unknown>;
}) => Promise<McpGateVerdict>;

export interface McpGateOptions {
  cwd: string;
  mode: Mode;
  permissions?: PermissionRules;
  contract?: FileContract;
  hooks?: HookDispatcher;
  autoMode?: AutoModeConfig;
}

/**
 * The gate every served tool call goes through.
 *
 * `mcp serve` hands Read/Write/Edit/Bash to whatever MCP client connected. There
 * is no human on this side of the pipe, so `ask` cannot be asked and resolves to
 * a refusal — the same fail-closed rule an unattended cron run follows. A peer
 * that wants more has to be granted it in `settings.json`, where it is written
 * down and reviewable, rather than by being the one who connected.
 */
export function buildMcpGate(options: McpGateOptions): McpToolGate {
  return async ({ tool, input }) => {
    const verdict = await dispatchToolCall({
      tool,
      input,
      mode: options.mode,
      rules: options.permissions,
      contract: options.contract,
      hooks: options.hooks,
      cwd: options.cwd,
      autoMode: options.autoMode,
    });
    if (verdict.decision === 'allow') return { allowed: true, reason: verdict.reason };
    if (verdict.decision === 'ask') {
      return {
        allowed: false,
        reason:
          `${verdict.reason}. \`deepcode mcp serve\` has no attached user, so a call needing ` +
          `approval is refused rather than granted. Add a matching rule to ` +
          `permissions.allow in settings.json, or start the server with an explicit --mode.`,
      };
    }
    return { allowed: false, reason: verdict.reason };
  };
}

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
  'TaskCreate',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskUpdate',
  'TaskStop',
  'Monitor',
]);

/** The subset of `tools` that is safe to expose over an MCP stdio server. */
export function mcpServableTools(tools: ToolHandler[] = BUILTIN_TOOLS): ToolHandler[] {
  return tools.filter((t) => !MCP_SERVE_EXCLUDE.has(t.name));
}

export interface BuildMcpServerOpts {
  /** Project directory tools resolve relative paths against. */
  cwd: string;
  /**
   * Policy gate for every call. **Required** — this server used to execute
   * Read/Write/Edit/Bash for any connected peer with no mode, no permission
   * rules, no file contract and no PreToolUse hooks. Making it required is the
   * point: safety must not depend on a host remembering an optional argument.
   * Build one with `buildMcpGate`.
   */
  gate: McpToolGate;
  /** Override the served tool set (default: stateless BUILTIN_TOOLS). */
  tools?: ToolHandler[];
  name?: string;
  version?: string;
  /** Abort signal propagated into each tool's ToolContext. */
  signal?: AbortSignal;
  /** Optional sandbox config forwarded to the Bash tool. */
  sandboxConfig?: ToolContext['sandboxConfig'];
  /** Path-axis rules, so Grep/Glob filter their results here too. */
  contract?: FileContract;
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
    const input = (req.params.arguments ?? {}) as Record<string, unknown>;
    const verdict = await opts.gate({ tool: tool.name, input });
    if (!verdict.allowed) {
      return {
        content: [{ type: 'text' as const, text: `Refused: ${verdict.reason}` }],
        isError: true,
      };
    }

    const ctx: ToolContext = {
      cwd: opts.cwd,
      signal: opts.signal,
      sandboxConfig: opts.sandboxConfig,
      contract: opts.contract,
    };
    try {
      const result = await tool.execute(input, ctx);
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
