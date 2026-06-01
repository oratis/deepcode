// Bash tool — execute a shell command with timeout, capture stdout+stderr+exitCode.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2 (P0) + run_in_background param
// M3.5: optionally wrapped under platform sandbox via ctx.sandboxConfig
// M3.5-ext: when network.allowedDomains is a non-empty allowlist on Linux, run
//   under the slirp4netns selective-network sandbox (spawnNetworkSandbox). If
//   that can't be set up (e.g. can't bind the DNS proxy on :53), fail CLOSED to
//   deny-all-net rather than running unrestricted.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  denyAllNetwork,
  needsNetworkSandbox,
  NetworkSandboxUnavailable,
  spawnNetworkSandbox,
  wrapBashCommand,
} from '../sandbox/index.js';
import type { NetworkSandboxHandle, SpawnNetworkSandboxOpts } from '../sandbox/index.js';
import type { SandboxConfig } from '../config/types.js';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface BashInput {
  command: string;
  timeout?: number; // ms
  description?: string; // shown in approval UI
  run_in_background?: boolean; // detach + stream output to a log file
}

// ToolContext carries sandbox config (+ optional test seams) from the loop owner.
type SandboxCtx = ToolContext & {
  sandboxConfig?: SandboxConfig;
  /** Test seam: override the platform used for the net-sandbox decision. */
  sandboxPlatform?: NodeJS.Platform;
  /** Test seam: override the network-sandbox spawner. */
  sandboxNetSpawn?: (opts: SpawnNetworkSandboxOpts) => Promise<NetworkSandboxHandle>;
};

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_OUTPUT_BYTES = 30_000;

// Monotonic suffix so two background spawns in the same millisecond from the
// same pid don't collide on a log filename.
let bgSeq = 0;

function capStream(s: string, label: string): string {
  return s.length > MAX_OUTPUT_BYTES
    ? s.slice(0, MAX_OUTPUT_BYTES) + `\n... [${label} truncated]`
    : s;
}

/** Build the standard Bash ToolResult from captured output + exit info. */
function summarize(
  stdout: string,
  stderr: string,
  killed: boolean,
  code: number | null,
  timeoutMs: number,
  note?: string,
): ToolResult {
  const parts: string[] = [];
  if (note) parts.push(note);
  if (stdout) parts.push(`<stdout>\n${stdout}\n</stdout>`);
  if (stderr) parts.push(`<stderr>\n${stderr}\n</stderr>`);
  if (killed) parts.push(`[killed by timeout after ${timeoutMs}ms]`);
  parts.push(`exit: ${code ?? 'unknown'}`);
  return {
    content: parts.join('\n'),
    data: { exitCode: code, killed, stdoutBytes: stdout.length, stderrBytes: stderr.length },
    isError: killed || (code !== null && code !== 0),
  };
}

/**
 * Foreground run under the slirp4netns selective-network sandbox. Rejects with
 * NetworkSandboxUnavailable if setup fails (caller falls back to deny-all-net).
 */
async function runForegroundNet(
  command: string,
  ctx: SandboxCtx,
  config: SandboxConfig,
  timeoutMs: number,
  spawnFn: (opts: SpawnNetworkSandboxOpts) => Promise<NetworkSandboxHandle>,
): Promise<ToolResult> {
  const handle = await spawnFn({ userCommand: command, cwd: ctx.cwd, config });
  return new Promise<ToolResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;
    let settled = false;
    const finish = (r: ToolResult): void => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const timer = setTimeout(() => {
      killed = true;
      void handle.close();
    }, timeoutMs);
    const onAbort = (): void => {
      killed = true;
      void handle.close();
    };
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    handle.child.stdout?.on('data', (c: Buffer) => {
      stdout = capStream(stdout + c.toString('utf8'), 'stdout');
    });
    handle.child.stderr?.on('data', (c: Buffer) => {
      stderr = capStream(stderr + c.toString('utf8'), 'stderr');
    });
    handle.exited
      .then((code) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener('abort', onAbort);
        finish(summarize(stdout, stderr, killed, code, timeoutMs));
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        ctx.signal?.removeEventListener('abort', onAbort);
        finish({ content: `Error running sandboxed command: ${String(err)}`, isError: true });
      });
  });
}

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
    const sctx = ctx as SandboxCtx;
    const sandboxCfg = sctx.sandboxConfig;
    const platform = sctx.sandboxPlatform ?? process.platform;
    // M3.5-ext: does this command want the selective-allowlist network sandbox?
    const useNet = needsNetworkSandbox(sandboxCfg, platform);

    // Background: spawn detached, stream stdout+stderr into a log file, and
    // return immediately. The agent reads the log path later (via Read) to see
    // progress/output. The process survives this turn (own process group).
    if (input.run_in_background) {
      // The selective allowlist needs a slirp4netns helper that must outlive the
      // turn — not supported for detached background commands. Fail CLOSED to
      // deny-all-net so a background command can't escape the allowlist.
      let bgCfg = sandboxCfg;
      let bgNote = '';
      if (useNet && sandboxCfg) {
        bgCfg = denyAllNetwork(sandboxCfg);
        bgNote =
          '[sandbox] selective network allowlist is not supported for background commands; running with NO network.\n';
      }
      const wrapped = await wrapBashCommand({
        userCommand: input.command,
        cwd: ctx.cwd,
        config: bgCfg,
      });
      const dir = join(ctx.sessionDir ?? tmpdir(), 'bg');
      const id = `bg-${Date.now().toString(36)}-${process.pid}-${bgSeq++}`;
      const logPath = join(dir, `${id}.log`);
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(logPath, `${bgNote}$ ${input.command}\n`, 'utf8');
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
            content: `${bgNote}Started in background (pid ${pid ?? 'unknown'}). Output streams to:\n${logPath}\nRead that file to check progress or results.`,
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

    // Foreground. Effective config + an optional note (set on fail-closed).
    let effectiveCfg = sandboxCfg;
    let failNote: string | undefined;

    if (useNet && sandboxCfg) {
      const spawnFn = sctx.sandboxNetSpawn ?? spawnNetworkSandbox;
      try {
        return await runForegroundNet(input.command, sctx, sandboxCfg, timeoutMs, spawnFn);
      } catch (err) {
        if (!(err instanceof NetworkSandboxUnavailable)) {
          return { content: `Error spawning sandboxed command: ${String(err)}`, isError: true };
        }
        // Fail CLOSED: run with no network rather than unrestricted.
        effectiveCfg = denyAllNetwork(sandboxCfg);
        failNote = `[sandbox] selective network allowlist unavailable (${err.message}); ran with NO network. See docs/security-model.md.`;
      }
    }

    const wrapped = await wrapBashCommand({
      userCommand: input.command,
      cwd: ctx.cwd,
      config: effectiveCfg,
    });

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
        stdout = capStream(stdout + chunk.toString('utf8'), 'stdout');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = capStream(stderr + chunk.toString('utf8'), 'stderr');
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
        resolvePromise(summarize(stdout, stderr, killed, code, timeoutMs, failNote));
      });
    });
  },
};
