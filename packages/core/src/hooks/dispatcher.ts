// Hook dispatcher — runs configured handlers for a given event.
// Spec: docs/DEVELOPMENT_PLAN.md §3.6
// M3 ships the `command` handler type only; http/mcp_tool/prompt/agent stubs return errors.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { HookHandler, HookMatcher, Hooks } from '../config/types.js';
import type { HookContext, HookHandlerOutput, HookResult } from './types.js';

export interface HookDispatcherOpts {
  hooks?: Hooks;
  disableAllHooks?: boolean;
  /** Default handler timeout if not specified. */
  defaultTimeoutMs?: number;
}

export class HookDispatcher {
  private readonly hooks: Hooks;
  private readonly disabled: boolean;
  private readonly defaultTimeoutMs: number;

  constructor(opts: HookDispatcherOpts) {
    this.hooks = opts.hooks ?? {};
    this.disabled = !!opts.disableAllHooks;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 60_000;
  }

  /**
   * Dispatch all hooks for an event. Handlers run sequentially (not in parallel) so
   * that later handlers can see the side effects of earlier ones.
   */
  async dispatch(ctx: HookContext): Promise<HookResult> {
    const result: HookResult = {
      stdout: '',
      stderr: '',
      anyBlocked: false,
      timings: [],
    };
    if (this.disabled) return result;

    const matchers = this.hooks[ctx.event] ?? [];
    for (const m of matchers) {
      if (!this.matcherApplies(m, ctx)) continue;
      for (const handler of m.hooks) {
        const t0 = Date.now();
        const out = await this.runHandler(handler, ctx);
        const dt = Date.now() - t0;
        result.stdout += out.stdout;
        result.stderr += out.stderr;
        if (out.exitCode !== 0) result.anyBlocked = true;
        result.timings.push({ matcher: m.matcher, durationMs: dt, exitCode: out.exitCode });

        // Try to parse the most recent stdout as JSON output schema
        const parsed = tryParseJsonOutput(out.stdout);
        if (parsed) result.json = parsed;
      }
    }
    return result;
  }

  private matcherApplies(matcher: HookMatcher, ctx: HookContext): boolean {
    if (!matcher.matcher) return true;
    // matcher syntax: tool-name (e.g. "Bash"), tool with subcommand ("Bash(git push:*)"),
    // or `|` separator for OR ("Edit|Write").
    if (ctx.event !== 'PreToolUse' && ctx.event !== 'PostToolUse') return true;
    const toolName = (ctx.payload['tool'] as string) ?? '';
    const alternatives = matcher.matcher.split('|').map((s) => s.trim());
    return alternatives.some((alt) => {
      const parenIdx = alt.indexOf('(');
      if (parenIdx === -1) return alt === toolName;
      const ruleTool = alt.slice(0, parenIdx);
      return ruleTool === toolName;
    });
  }

  private async runHandler(
    handler: HookHandler,
    ctx: HookContext,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (handler.type !== 'command') {
      // M3 only implements `command` type; others return error stub
      return {
        stdout: '',
        stderr: `Hook handler type "${handler.type}" is not implemented yet (planned M5+).`,
        exitCode: 0, // don't block agent on unimplemented handlers
      };
    }
    const cmd = handler.command;
    if (!cmd) {
      return { stdout: '', stderr: 'Missing command in hook config.', exitCode: 0 };
    }
    return runCommand({
      command: cmd,
      cwd: ctx.cwd,
      timeoutMs: handler.timeout ? handler.timeout * 1000 : this.defaultTimeoutMs,
      env: {
        ...process.env,
        ...(ctx.env ?? {}),
        DEEPCODE_HOOK_EVENT: ctx.event,
        DEEPCODE_TRIGGERED_AT: ctx.triggeredAt,
      },
      stdin: JSON.stringify({ event: ctx.event, payload: ctx.payload }),
    });
  }
}

interface RunCommandOpts {
  command: string;
  cwd: string;
  timeoutMs: number;
  env: Record<string, string | undefined>;
  stdin?: string;
}

export function runCommand(
  opts: RunCommandOpts,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolveResult) => {
    const cwd = resolve(opts.cwd);
    const child = spawn('/bin/sh', ['-c', opts.command], { cwd, env: opts.env });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      // SIGKILL — see comment in bash.ts; dash on Ubuntu doesn't propagate SIGTERM.
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolveResult({ stdout, stderr: stderr + (err as Error).message, exitCode: 127 });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      let exitCode = code ?? 0;
      if (killed) {
        stderr += `\n[killed by timeout after ${opts.timeoutMs}ms]`;
        exitCode = 124;
      }
      resolveResult({ stdout, stderr, exitCode });
    });

    // Suppress EPIPE / EBADF when the child closes stdin before our write
    // completes (handlers that don't read stdin are common and harmless).
    child.stdin.on('error', () => {
      // swallow
    });
    if (opts.stdin) {
      try {
        child.stdin.write(opts.stdin);
      } catch {
        // pipe already closed — fine
      }
    }
    try {
      child.stdin.end();
    } catch {
      // already ended — fine
    }
  });
}

/** Extract a JSON object from handler stdout, if any. Returns null on parse failure. */
export function tryParseJsonOutput(stdout: string): HookHandlerOutput | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  // Try to find the last JSON object in the output (handlers may print logs first)
  const candidates: string[] = [];
  // Strategy: scan from the end for matching {...}
  const lastOpen = trimmed.lastIndexOf('{');
  if (lastOpen >= 0) {
    candidates.push(trimmed.slice(lastOpen));
  }
  candidates.push(trimmed);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as HookHandlerOutput;
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}
