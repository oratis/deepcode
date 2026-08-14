// ShellOpen / ShellRun / ShellClose / ShellList — a shell that remembers.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.4

import { isAbsolute, resolve } from 'node:path';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

function noRegistry(): ToolResult {
  return {
    content:
      'Error: persistent shells are not available in this run. Use the Bash tool, and repeat any cd/export prefix each call.',
    isError: true,
  };
}

export const ShellOpenTool: ToolHandler = {
  name: 'ShellOpen',
  definition: {
    name: 'ShellOpen',
    description:
      'Opens a shell that stays alive across calls, keeping its working directory, environment, shell functions, and background jobs. Use it when several commands depend on each other (activate a venv then install; cd then build; start a server then watch its log). One-off commands should still use Bash. Full-screen interactive programs (vim, top, less) do NOT work — commands run with stdin closed. Close it with ShellClose when done.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Directory to start in (default: the workspace).' },
      },
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.shells) return noRegistry();
    const requested = rawInput['cwd'];
    const cwd =
      typeof requested === 'string' && requested.length > 0
        ? isAbsolute(requested)
          ? requested
          : resolve(ctx.cwd, requested)
        : ctx.cwd;

    try {
      const id = await ctx.shells.open({
        cwd,
        ...(ctx.sandboxConfig !== undefined ? { sandboxConfig: ctx.sandboxConfig } : {}),
        ...(ctx.sandboxDefaultMode !== undefined
          ? { sandboxDefaultMode: ctx.sandboxDefaultMode }
          : {}),
      });
      return {
        content: `Opened ${id} in ${cwd}. Run commands with ShellRun({ shell_id: "${id}", command: "..." }).\nIts sandbox policy is fixed as of now; changing sandbox settings later will not re-arm it.`,
        data: { shellId: id, cwd },
      };
    } catch (err) {
      return { content: `Error opening shell: ${(err as Error).message}`, isError: true };
    }
  },
};

export const ShellRunTool: ToolHandler = {
  name: 'ShellRun',
  definition: {
    name: 'ShellRun',
    description:
      'Runs a command in a shell opened by ShellOpen. State set by earlier commands (cd, export, activated environments) still applies. Returns output and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        shell_id: { type: 'string', description: 'Id returned by ShellOpen.' },
        command: { type: 'string', description: 'Shell source to run. Multi-line is fine.' },
        timeout: { type: 'number', description: `Milliseconds (default ${DEFAULT_TIMEOUT_MS}).` },
      },
      required: ['shell_id', 'command'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.shells) return noRegistry();
    const shellId = rawInput['shell_id'];
    const command = rawInput['command'];
    if (typeof shellId !== 'string' || typeof command !== 'string' || command.length === 0) {
      return { content: 'Error: shell_id and command are required (strings).', isError: true };
    }
    const shell = ctx.shells.get(shellId);
    if (!shell) {
      return {
        content: `Error: no open shell ${shellId}. It may have been closed or timed out; open a new one with ShellOpen.`,
        isError: true,
      };
    }

    const requested = rawInput['timeout'];
    const timeoutMs =
      typeof requested === 'number' && requested > 0
        ? Math.min(requested, MAX_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;

    let result;
    try {
      result = await shell.run(command, timeoutMs);
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`, isError: true };
    }
    ctx.shells.touch(shellId);

    if (result.discarded) {
      // Say what is actually true: the command was interrupted, the shell could
      // not be brought back, and any state it held is gone.
      return {
        content: `${result.output}\n\n[${shellId} did not respond after ${timeoutMs}ms and was discarded. Whatever the command changed is unknown, and the shell's state — working directory, environment, background jobs — is gone. Open a new shell.]`,
        isError: true,
        data: { shellId, discarded: true, timedOut: result.timedOut },
      };
    }

    const parts = [result.output];
    if (result.timedOut) {
      parts.push(`[interrupted after ${timeoutMs}ms; the shell is still usable]`);
    }
    parts.push(`exit: ${result.exitCode ?? 'unknown'}`);
    return {
      content: parts.filter((p) => p.length > 0).join('\n'),
      isError: result.timedOut || (result.exitCode !== null && result.exitCode !== 0),
      data: { shellId, exitCode: result.exitCode, timedOut: result.timedOut },
    };
  },
};

export const ShellCloseTool: ToolHandler = {
  name: 'ShellClose',
  definition: {
    name: 'ShellClose',
    description:
      'Closes a shell opened by ShellOpen, stopping anything still running in it. Close shells you no longer need.',
    inputSchema: {
      type: 'object',
      properties: { shell_id: { type: 'string', description: 'Id returned by ShellOpen.' } },
      required: ['shell_id'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.shells) return noRegistry();
    const shellId = rawInput['shell_id'];
    if (typeof shellId !== 'string') {
      return { content: 'Error: shell_id is required (string).', isError: true };
    }
    const closed = await ctx.shells.close(shellId);
    return closed
      ? { content: `Closed ${shellId}.`, data: { shellId } }
      : { content: `No open shell ${shellId}; nothing to close.`, data: { shellId } };
  },
};

export const ShellListTool: ToolHandler = {
  name: 'ShellList',
  definition: {
    name: 'ShellList',
    description:
      'Lists the shells currently open, with where each started and when it was last used.',
    inputSchema: { type: 'object', properties: {} },
  },
  execute(_rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.shells) return Promise.resolve(noRegistry());
    const shells = ctx.shells.list();
    if (shells.length === 0) {
      return Promise.resolve({ content: 'No shells open.', data: { count: 0 } });
    }
    const lines = shells.map(
      (s) => `${s.id}  ${s.cwd}  last used ${s.lastUsedAt}${s.busy ? '  [running]' : ''}`,
    );
    return Promise.resolve({
      content: `${shells.length} shell(s) open:\n${lines.join('\n')}`,
      data: { count: shells.length },
    });
  },
};

/** Every persistent-shell tool, for registration. */
export const SHELL_TOOLS: ToolHandler[] = [
  ShellOpenTool,
  ShellRunTool,
  ShellCloseTool,
  ShellListTool,
];
