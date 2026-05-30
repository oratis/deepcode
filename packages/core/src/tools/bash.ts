// Bash tool — execute a shell command with timeout, capture stdout+stderr+exitCode.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2 (P0) + run_in_background param
// M3.5: optionally wrapped under platform sandbox via ctx.sandboxConfig

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wrapBashCommand } from '../sandbox/index.js';
import type { SandboxConfig } from '../config/types.js';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface BashInput {
  command: string;
  timeout?: number; // ms
  description?: string; // shown in approval UI
  run_in_background?: boolean; // detach + stream output to a log file
}

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_OUTPUT_BYTES = 30_000;

// Monotonic suffix so two background spawns in the same millisecond from the
// same pid don't collide on a log filename.
let bgSeq = 0;

export const BashTool: ToolHandler = {
  name: 'Bash',
  definition: {
    name: 'Bash',
    description:
      'Executes a shell command. Captures stdout/stderr/exitCode. Default timeout 2 min.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command line to execute via /bin/sh -c.' },
        timeout: { type: 'number', description: 'Milliseconds (default 120000).' },
        description: {
          type: 'string',
          description: 'Short description shown to user during approval.',
        },
        run_in_background: {
          type: 'boolean',
          description:
            'Run detached and return immediately. Output streams to a log file whose path is in the result — Read that file to see progress/results. Use for long-running or watch processes (dev servers, tail -f, test watchers).',
        },
      },
      required: ['command'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as BashInput;
    if (!input?.command || typeof input.command !== 'string') {
      return { content: 'Error: command is required (string).', isError: true };
    }
    const timeoutMs = Math.max(1_000, input.timeout ?? DEFAULT_TIMEOUT_MS);

    // M3.5: wrap under platform sandbox if configured. ctx.sandboxConfig is
    // populated by the agent loop owner (CLI REPL passes settings.sandbox).
    const sandboxCfg = (ctx as ToolContext & { sandboxConfig?: SandboxConfig }).sandboxConfig;
    const wrapped = await wrapBashCommand({
      userCommand: input.command,
      cwd: ctx.cwd,
      config: sandboxCfg,
    });

    // Background: spawn detached, stream stdout+stderr into a log file, and
    // return immediately. The agent reads the log path later (via Read) to see
    // progress/output. The process survives this turn (own process group).
    if (input.run_in_background) {
      const dir = join(ctx.sessionDir ?? tmpdir(), 'bg');
      const id = `bg-${Date.now().toString(36)}-${process.pid}-${bgSeq++}`;
      const logPath = join(dir, `${id}.log`);
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(logPath, `$ ${input.command}\n`, 'utf8');
        const fh = await fs.open(logPath, 'a');
        try {
          const child = spawn(wrapped.command, wrapped.args, {
            cwd: ctx.cwd,
            detached: true,
            stdio: ['ignore', fh.fd, fh.fd],
          });
          const pid = child.pid;
          child.unref();
          return {
            content: `Started in background (pid ${pid ?? 'unknown'}). Output streams to:\n${logPath}\nRead that file to check progress or results.`,
            data: { background: true, pid, logPath, id },
          };
        } finally {
          await fh.close(); // child holds its own dup of the fd
        }
      } catch (err) {
        return {
          content: `Error starting background command: ${(err as Error).message}`,
          isError: true,
        };
      }
    }

    return new Promise((resolvePromise) => {
      const child = spawn(wrapped.command, wrapped.args, {
        cwd: ctx.cwd,
        signal: ctx.signal,
      });
      let stdout = '';
      let stderr = '';
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        // SIGKILL + destroy pipes — on Ubuntu CI, dash leaves orphaned children
        // whose inherited stdout/stderr fds keep `close` from firing on the
        // parent. Destroying the pipes forces close.
        child.kill('SIGKILL');
        child.stdout?.destroy();
        child.stderr?.destroy();
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.length > MAX_OUTPUT_BYTES) {
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + '\n... [stdout truncated]';
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > MAX_OUTPUT_BYTES) {
          stderr = stderr.slice(0, MAX_OUTPUT_BYTES) + '\n... [stderr truncated]';
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolvePromise({
          content: `Error spawning command: ${err.message}`,
          isError: true,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const summaryParts: string[] = [];
        if (stdout) summaryParts.push(`<stdout>\n${stdout}\n</stdout>`);
        if (stderr) summaryParts.push(`<stderr>\n${stderr}\n</stderr>`);
        if (killed) summaryParts.push(`[killed by timeout after ${timeoutMs}ms]`);
        summaryParts.push(`exit: ${code ?? 'unknown'}`);
        const isError = killed || (code !== null && code !== 0);
        resolvePromise({
          content: summaryParts.join('\n'),
          data: { exitCode: code, killed, stdoutBytes: stdout.length, stderrBytes: stderr.length },
          isError,
        });
      });
    });
  },
};
