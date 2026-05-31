// `deepcode mcp <serve|...>` — MCP subcommands.
// Spec: docs/DEVELOPMENT_PLAN.md §3.3
//
// `mcp serve` exposes DeepCode's stateless tools as an MCP server over stdio.
// CRITICAL: in serve mode stdout is the JSON-RPC channel — every diagnostic
// line goes to stderr, and nothing else may touch stdout.

import {
  VERSION,
  mcpServableTools,
  serveMcpOverStdio,
  type ServeMcpStdioOpts,
} from '@deepcode/core';
import type { Writable } from 'node:stream';

export interface McpCmdDeps {
  cwd: string;
  /** Diagnostics sink — defaults to process.stderr (NEVER stdout in serve mode). */
  errOutput?: Writable;
  /** Help/normal output sink — defaults to process.stdout. */
  output?: Writable;
  /** Abort signal to stop the server (tests / SIGINT). */
  signal?: AbortSignal;
  /** Serve implementation — injectable so tests don't grab the real stdio. */
  serve?: (opts: ServeMcpStdioOpts) => Promise<void>;
}

export async function runMcpCommand(sub: string[], deps: McpCmdDeps): Promise<number> {
  const err = deps.errOutput ?? process.stderr;
  const out = deps.output ?? process.stdout;
  const cmd = sub[0];

  if (cmd === 'serve') {
    const tools = mcpServableTools();
    err.write(
      `DeepCode MCP server v${VERSION} — exposing ${tools.length} tools over stdio in ${deps.cwd}\n`,
    );
    await (deps.serve ?? serveMcpOverStdio)({
      cwd: deps.cwd,
      version: VERSION,
      signal: deps.signal,
      onReady: (names) => err.write(`[mcp] ready: ${names.join(', ')}\n`),
    });
    return 0;
  }

  out.write(mcpHelp());
  return cmd ? 2 : 0;
}

function mcpHelp(): string {
  return [
    'Usage: deepcode mcp <command>',
    '',
    '  serve     Expose DeepCode tools as an MCP server over stdio',
    '',
    'Add to another MCP client (e.g. Claude Desktop) as:',
    '  { "command": "deepcode", "args": ["mcp", "serve"] }',
    '',
    'Configure servers DeepCode connects TO in settings.json under mcpServers.',
    '',
  ].join('\n');
}
