// `deepcode mcp <serve|...>` — MCP subcommands.
// Spec: docs/DEVELOPMENT_PLAN.md §3.3
//
// `mcp serve` exposes DeepCode's stateless tools as an MCP server over stdio.
// CRITICAL: in serve mode stdout is the JSON-RPC channel — every diagnostic
// line goes to stderr, and nothing else may touch stdout.

import {
  HookDispatcher,
  VERSION,
  buildMcpGate,
  describeClamp,
  gateUntrustedSettings,
  loadFileContract,
  loadSettings,
  mcpServableTools,
  resolveTriggerMode,
  serveMcpOverStdio,
  withSandboxMode,
  type Mode,
  type SandboxMode,
  type ServeMcpStdioOpts,
} from '@deepcode/core';
import type { Writable } from 'node:stream';
import { TrustStore } from './trust.js';

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
  /** Override `~/.deepcode` (tests). */
  home?: string;
  /** `--mode`: the explicit opt-in out of the unattended clamp. */
  mode?: Mode;
  /** `--sandbox`: tightens the sandbox for served commands. */
  sandbox?: SandboxMode;
}

export async function runMcpCommand(sub: string[], deps: McpCmdDeps): Promise<number> {
  const err = deps.errOutput ?? process.stderr;
  const out = deps.output ?? process.stdout;
  const cmd = sub[0];

  if (cmd === 'serve') {
    const tools = mcpServableTools();
    const { cwd } = deps;

    // The served tools are Read/Write/Edit/Bash in a real project. Which of
    // them a peer may call is a settings question, not a "you connected, so
    // you may" question — so load the same policy every other host loads,
    // including the directory trust gate that stops an untrusted checkout from
    // widening its own permissions.
    const loaded = await loadSettings({ cwd, home: deps.home });
    const trustStatus = await new TrustStore({ home: deps.home }).statusFor(cwd);
    const trustGate = gateUntrustedSettings(loaded, trustStatus);
    const settings = trustGate.settings;
    if (trustGate.gated.length > 0) {
      err.write(
        `[mcp] untrusted directory — ignoring project ${trustGate.gated.join(', ')}. ` +
          `Run \`deepcode trust\` to enable.\n`,
      );
    }

    // Nobody is attached to this pipe, so a permissive `defaultMode` picked for
    // REPL convenience must not become the posture of whatever connects. Same
    // clamp, and the same explicit opt-in, that scheduled jobs use.
    const ambient = (settings.permissions?.defaultMode ?? 'default') as Mode;
    const resolved = resolveTriggerMode(deps.mode ? { mode: deps.mode } : undefined, ambient);
    const clampNote = describeClamp(resolved);
    if (clampNote) err.write(`[mcp] ${clampNote}\n`);

    const contract = await loadFileContract({ cwd, home: deps.home });
    if (contract.status === 'invalid') {
      err.write(`[mcp] file contract could not be parsed: ${contract.error}\n`);
    }

    const hooks = new HookDispatcher({
      hooks: settings.hooks,
      disableAllHooks: settings.disableAllHooks,
      allowedHttpHookUrls: settings.allowedHttpHookUrls,
    });

    err.write(
      `DeepCode MCP server v${VERSION} — exposing ${tools.length} tools over stdio in ${cwd}\n`,
    );
    err.write(`[mcp] mode=${resolved.mode}; calls needing approval are refused, not granted\n`);

    await (deps.serve ?? serveMcpOverStdio)({
      cwd,
      version: VERSION,
      signal: deps.signal,
      gate: buildMcpGate({
        cwd,
        mode: resolved.mode,
        permissions: settings.permissions,
        contract: contract.contract,
        hooks,
        autoMode: settings.autoMode,
      }),
      contract: contract.contract,
      sandboxConfig: withSandboxMode(settings.sandbox, deps.sandbox),
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
