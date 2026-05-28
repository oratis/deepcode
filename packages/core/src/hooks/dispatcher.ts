// Hook dispatcher — runs configured handlers for a given event.
// Spec: docs/DEVELOPMENT_PLAN.md §3.6
// M3 ships the `command` handler type only; http/mcp_tool/prompt/agent stubs return errors.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { matchRule } from '../config/permissions.js';
import type { HookHandler, HookMatcher, Hooks } from '../config/types.js';
import type { HookContext, HookHandlerOutput, HookResult } from './types.js';

export interface HookDispatcherOpts {
  hooks?: Hooks;
  disableAllHooks?: boolean;
  /** Default handler timeout if not specified. */
  defaultTimeoutMs?: number;
  /** http hook URLs allowed (prefix match). Empty array = allow all. */
  allowedHttpHookUrls?: string[];
  /**
   * Callback to dispatch an mcp_tool hook. Wired by the CLI bootstrap with
   * the live MCP client. Receives the handler config + the hook payload;
   * returns whatever the MCP tool emitted (stringified for stdout).
   */
  mcpToolDispatcher?: (
    handler: { server: string; tool: string; arguments?: Record<string, unknown> },
    payload: unknown,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /**
   * Callback to dispatch a sub-agent hook. Receives the handler's agent name +
   * payload and returns the sub-agent's stdout. Wired by the CLI bootstrap
   * once sub-agents are loadable.
   */
  agentDispatcher?: (
    handler: { agent: string; prompt?: string },
    payload: unknown,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export class HookDispatcher {
  private hooks: Hooks;
  private readonly disabled: boolean;
  private readonly defaultTimeoutMs: number;
  private readonly allowedHttpHookUrls?: string[];
  private readonly mcpToolDispatcher?: HookDispatcherOpts['mcpToolDispatcher'];
  private readonly agentDispatcher?: HookDispatcherOpts['agentDispatcher'];

  constructor(opts: HookDispatcherOpts) {
    this.hooks = opts.hooks ?? {};
    this.disabled = !!opts.disableAllHooks;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 60_000;
    this.allowedHttpHookUrls = opts.allowedHttpHookUrls;
    this.mcpToolDispatcher = opts.mcpToolDispatcher;
    this.agentDispatcher = opts.agentDispatcher;
  }

  /**
   * Merge additional hook matchers into the dispatcher (e.g. from plugins).
   * Matchers under the same event name are appended in order.
   */
  mergeHooks(extra: Hooks): void {
    for (const [event, matchers] of Object.entries(extra) as Array<
      [keyof Hooks, HookMatcher[] | undefined]
    >) {
      if (!matchers || matchers.length === 0) continue;
      const existing = this.hooks[event] ?? [];
      this.hooks[event] = [...existing, ...matchers];
    }
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
        // `if` field: permission-rule-syntax filter that further gates this specific handler
        if (handler.if && !ifFieldMatches(handler.if, ctx)) continue;
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
    const payloadJson = JSON.stringify({ event: ctx.event, payload: ctx.payload });
    switch (handler.type) {
      case 'command':
        return this.runCommandHandler(handler, ctx, payloadJson);
      case 'http':
        return this.runHttpHandler(handler, ctx, payloadJson);
      case 'prompt':
        // Prompt-type: append the handler's prompt text as additionalContext.
        // The agent loop owner consumes hook output.json.additionalContext.
        return {
          stdout: JSON.stringify({ additionalContext: handler.prompt ?? '' }),
          stderr: '',
          exitCode: 0,
        };
      case 'mcp_tool':
        if (!this.mcpToolDispatcher) {
          return {
            stdout: '',
            stderr:
              'mcp_tool hook: no mcpToolDispatcher wired (host CLI must pass one in to enable).',
            exitCode: 0,
          };
        }
        if (!handler.server || !handler.tool) {
          return {
            stdout: '',
            stderr: 'mcp_tool hook missing required `server` or `tool` field.',
            exitCode: 0,
          };
        }
        try {
          return await this.mcpToolDispatcher(
            {
              server: handler.server,
              tool: handler.tool,
              arguments: { event: ctx.event, payload: ctx.payload },
            },
            ctx.payload,
          );
        } catch (err) {
          return { stdout: '', stderr: (err as Error).message, exitCode: 1 };
        }
      case 'agent':
        if (!this.agentDispatcher) {
          return {
            stdout: '',
            stderr:
              'agent hook: no agentDispatcher wired (host CLI must pass one in to enable).',
            exitCode: 0,
          };
        }
        if (!handler.agent) {
          return {
            stdout: '',
            stderr: 'agent hook missing required `agent` field.',
            exitCode: 0,
          };
        }
        try {
          return await this.agentDispatcher(
            { agent: handler.agent, prompt: handler.prompt },
            ctx.payload,
          );
        } catch (err) {
          return { stdout: '', stderr: (err as Error).message, exitCode: 1 };
        }
      default:
        return {
          stdout: '',
          stderr: `Unknown hook handler type: ${(handler as { type: string }).type}`,
          exitCode: 0,
        };
    }
  }

  private async runCommandHandler(
    handler: HookHandler,
    ctx: HookContext,
    payloadJson: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const cmd = handler.command;
    if (!cmd) return { stdout: '', stderr: 'Missing command in hook config.', exitCode: 0 };
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
      stdin: payloadJson,
    });
  }

  private async runHttpHandler(
    handler: HookHandler,
    _ctx: HookContext,
    payloadJson: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!handler.url)
      return { stdout: '', stderr: 'Missing url in http hook config.', exitCode: 0 };
    // Optional URL whitelist (settings.allowedHttpHookUrls passed via opts).
    // The dispatcher knows the whitelist; enforced at construction time via
    // allowedHttpHookUrls (we wire it in the constructor below).
    if (this.allowedHttpHookUrls && this.allowedHttpHookUrls.length > 0) {
      const allowed = this.allowedHttpHookUrls.some((p) => handler.url!.startsWith(p));
      if (!allowed) {
        return {
          stdout: '',
          stderr: `http hook URL "${handler.url}" not in allowedHttpHookUrls`,
          exitCode: 0,
        };
      }
    }
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(handler.headers ?? {}),
      };
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        handler.timeout ? handler.timeout * 1000 : 30_000,
      );
      try {
        const res = await fetch(handler.url, {
          method: 'POST',
          headers,
          body: payloadJson,
          signal: controller.signal,
        });
        clearTimeout(timer);
        const text = await res.text();
        return {
          stdout: text,
          stderr: '',
          exitCode: res.ok ? 0 : res.status,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return {
        stdout: '',
        stderr: `http hook fetch failed: ${(err as Error).message}`,
        exitCode: 1,
      };
    }
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
      // SIGKILL + destroy pipes — see bash.ts; needed for orphaned grandchild
      // pipes on Ubuntu CI (dash doesn't propagate signals).
      child.kill('SIGKILL');
      child.stdout?.destroy();
      child.stderr?.destroy();
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

/**
 * `if` field — permission-rule syntax filter for hook handlers.
 * Reuses matchRule from the permissions matcher.
 */
function ifFieldMatches(ifRule: string, ctx: HookContext): boolean {
  if (ctx.event !== 'PreToolUse' && ctx.event !== 'PostToolUse') return true;
  const toolName = (ctx.payload['tool'] as string) ?? '';
  const input = (ctx.payload['input'] as Record<string, unknown>) ?? {};
  return matchRule(ifRule, { tool: toolName, input });
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
