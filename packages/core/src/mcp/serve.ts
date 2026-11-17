// `deepcode mcp serve` — expose DeepCode's built-in tools as an MCP server over
// stdio, so other MCP clients (Claude Desktop, another DeepCode, etc.) can call
// Read/Write/Edit/Bash/Grep/Glob/… in a project directory.
// Spec: docs/DEVELOPMENT_PLAN.md §3.3 (mcp serve)
//
// We expose only STATELESS tools. The interactive / host-coupled tools need
// context an MCP peer can't provide (AskUserQuestion → askUser callback;
// EnterPlanMode/ExitPlanMode → modeSignal; Task → runSubAgent; worktree tools
// mutate the live ctx; Cron* manage a local scheduler) so they're excluded.

import { randomUUID } from 'node:crypto';
import { ToolExecutionService, type ToolExecutionOptions } from '../runtime/tool-execution.js';
import { ToolRegistry } from '../tools/registry.js';
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

const gatePolicies = new WeakMap<McpToolGate, McpGateOptions>();

export interface McpGateOptions {
  cwd: string;
  mode: Mode;
  permissions?: PermissionRules;
  contract?: FileContract;
  hooks?: HookDispatcher;
  autoMode?: AutoModeConfig;
  sandboxConfig?: ToolContext['sandboxConfig'];
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
  const gate: McpToolGate = async ({ tool, input }) => {
    const verdict = await dispatchToolCall({
      tool,
      input,
      mode: options.mode,
      rules: options.permissions,
      contract: options.contract,
      hooks: options.hooks,
      cwd: options.cwd,
      autoMode: options.autoMode,
      sandboxConfig: options.sandboxConfig,
      sandboxDefaultMode: 'workspace-write',
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
  gatePolicies.set(gate, { ...options });
  return gate;
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
  /** Shared settlement options; policy comes from buildMcpGate, never the peer. */
  execution?: Pick<
    ToolExecutionOptions,
    'session' | 'ledger' | 'spillStore' | 'spillThresholdChars' | 'toolDeadlines' | 'onEvent'
  >;
}

/**
 * Build (but don't connect) an MCP `Server` that lists + executes the given
 * tools. Returned unconnected so callers can attach any transport — stdio in
 * production, an in-memory pair in tests.
 */
export function buildMcpServer(opts: BuildMcpServerOpts): Server {
  const tools = opts.tools ?? mcpServableTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const policy = gatePolicies.get(opts.gate);
  const execution = new ToolExecutionService({
    ...opts.execution,
    ...policy,
    cwd: opts.cwd,
    tools: new ToolRegistry(tools),
    mode: policy?.mode ?? 'default',
    unattended: true,
    signal: opts.signal,
    contract: opts.contract ?? policy?.contract,
    sandboxConfig: opts.sandboxConfig ?? policy?.sandboxConfig,
    restrict: policy
      ? undefined
      : async (name, input) => {
          const verdict = await opts.gate({ tool: name, input });
          return verdict.allowed ? undefined : verdict.reason;
        },
  });
  const server = new Server(
    { name: opts.name ?? 'deepcode', version: opts.version ?? '0.0.0' },
    { capabilities: { tools: {} } },
  );
  const closeTransport = server.close.bind(server);
  server.close = async () => {
    await Promise.all([execution.close(), closeTransport()]);
  };
  server.onclose = () => {
    void execution.close().catch((error: unknown) => {
      process.stderr.write(`MCP cleanup failed: ${(error as Error).message}\n`);
    });
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.definition.description,
      inputSchema: tool.definition.inputSchema as { type: 'object' },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    if (!byName.has(req.params.name))
      return {
        content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
        isError: true,
      };
    try {
      const result = await execution.run(
        req.params.name,
        req.params.arguments ?? {},
        randomUUID(),
        extra.signal,
      );
      return {
        content: [{ type: 'text', text: result.content }],
        isError: result.isError ?? false,
      };
    } catch (error) {
      return { content: [{ type: 'text', text: (error as Error).message }], isError: true };
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
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', stop);
      void server.close().then(resolve, reject);
    };
    const previousClose = server.onclose;
    server.onclose = () => {
      previousClose?.();
      finish();
    };
    const stop = () => finish();
    if (opts.signal?.aborted) stop();
    else opts.signal?.addEventListener('abort', stop, { once: true });
  });
}
