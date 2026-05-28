// statusLine command runner — periodically exec a user-defined command,
// pipe session JSON to its stdin, render stdout in the CLI/GUI status area.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.8

import { spawn } from 'node:child_process';
import type { StatusLineConfig } from '../config/types.js';

export interface StatusLinePayload {
  session_id: string;
  model: string;
  cwd: string;
  mode: string;
  effort: string;
  transcript_path?: string;
  cost?: { yuan: number };
  version: string;
  output_style?: string;
}

export interface StatusLineRunnerOpts {
  config: StatusLineConfig;
  /** Function the runner calls to get the latest payload. */
  payload: () => StatusLinePayload;
  /** Function the runner calls with new stdout text whenever it changes. */
  onUpdate: (text: string) => void;
  /** Refresh period in ms (default 5000). Read from
   *  DEEPCODE_STATUS_LINE_DEBOUNCE_MS env var if set. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 5000;
const COMMAND_TIMEOUT_MS = 2000; // statusline commands should be quick

export class StatusLineRunner {
  private readonly opts: StatusLineRunnerOpts;
  private readonly debounceMs: number;
  private timer: NodeJS.Timeout | null = null;
  private lastText: string = '';
  private running = false;

  constructor(opts: StatusLineRunnerOpts) {
    this.opts = opts;
    this.debounceMs =
      opts.debounceMs ??
      (process.env.DEEPCODE_STATUS_LINE_DEBOUNCE_MS
        ? Number.parseInt(process.env.DEEPCODE_STATUS_LINE_DEBOUNCE_MS, 10)
        : DEFAULT_DEBOUNCE_MS);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Fire once immediately, then schedule periodic
    this.tick();
    this.timer = setInterval(() => this.tick(), this.debounceMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Force an immediate refresh (e.g. after the model changes). */
  refresh(): void {
    if (this.running) this.tick();
  }

  private async tick(): Promise<void> {
    const payload = this.opts.payload();
    const stdin = JSON.stringify(payload);
    const text = await runStatusLineCommand(this.opts.config, stdin);
    if (text !== this.lastText) {
      this.lastText = text;
      this.opts.onUpdate(text);
    }
  }
}

/**
 * Execute the statusLine command with the JSON payload on stdin.
 * Returns the trimmed stdout. On failure returns an empty string.
 */
export function runStatusLineCommand(
  config: StatusLineConfig,
  stdinPayload: string,
): Promise<string> {
  return new Promise((resolveResult) => {
    if (config.type !== 'command' || !config.command) {
      resolveResult('');
      return;
    }
    const child = spawn('/bin/sh', ['-c', config.command]);
    let stdout = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, COMMAND_TIMEOUT_MS);
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    // Suppress unhandled EPIPE if the script doesn't read stdin
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      resolveResult('');
    });
    child.on('close', () => {
      clearTimeout(timer);
      if (killed) {
        resolveResult('');
        return;
      }
      // Cap output at 200 chars (matches plan-mentioned constraint)
      resolveResult(stdout.trim().slice(0, 200));
    });
    try {
      child.stdin.write(stdinPayload);
    } catch {
      /* pipe closed */
    }
    try {
      child.stdin.end();
    } catch {
      /* already ended */
    }
  });
}
