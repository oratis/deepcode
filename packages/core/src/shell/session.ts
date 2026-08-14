// A shell that survives between tool calls.
//
// Spec: docs/DSH_ADOPTION_PLAN.md §1.4
//
// Every `Bash` call is a fresh process, so `cd`, `export`, and
// `source venv/bin/activate` are all forgotten the moment they return. The
// model's workaround is to re-paste the whole prefix into every command, which
// is long, easy to get wrong, and still cannot hold a background server.
//
// This is NOT a PTY. dsh uses one; a PTY means `node-pty`, a native dependency
// needing a build for every platform the desktop ships to — a real release risk
// for a benefit (full-screen programs like vim and top) that is a small part of
// what makes a persistent shell useful. Instead the shell runs over ordinary
// pipes and command completion is detected with a sentinel line. Interactive
// full-screen programs do not work here, and the tool description says so.
//
// Two consequences of the pipe design, both deliberate:
//
//   * Each command runs with stdin from /dev/null. Otherwise a command that
//     reads stdin (`cat`, an interactive prompt) would swallow the sentinel
//     that follows it and the session would hang until its deadline.
//   * stderr is merged into stdout at the shell, so the two interleave in the
//     order they were actually written, the way a terminal shows them.

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { SandboxConfig, SandboxMode } from '../config/types.js';
import { wrapBashCommand } from '../sandbox/index.js';

/** Result of one command run in a persistent shell. */
export interface ShellRunResult {
  /** Everything the command wrote, stdout and stderr interleaved. */
  output: string;
  /** Exit status, or null when the command did not finish. */
  exitCode: number | null;
  /** True when the deadline elapsed before the command finished. */
  timedOut: boolean;
  /**
   * True when the shell could not be recovered and has been discarded. The
   * caller must open a new one; this session's id is dead.
   */
  discarded: boolean;
}

export interface ShellSessionOptions {
  /** Directory the shell starts in. */
  cwd: string;
  /** Sandbox configuration, applied once when the shell starts. */
  sandboxConfig?: SandboxConfig;
  /** Sandbox mode when the config names none. */
  sandboxDefaultMode?: SandboxMode;
  /** Environment for the shell process. Defaults to the parent's. */
  env?: NodeJS.ProcessEnv;
}

/** How long to wait for the shell to recover after interrupting a command. */
const RECOVERY_GRACE_MS = 2_000;

/** Bytes of output one command may accumulate before older output is dropped. */
const MAX_OUTPUT_CHARS = 2_000_000;

/**
 * A long-lived shell process, one command at a time.
 *
 * The shell keeps its working directory, environment, functions, and any
 * background jobs across calls, which is the entire point.
 */
export class PersistentShell {
  /** Random per session, so a command cannot forge it even by accident. */
  readonly #sentinel = `__DEEPCODE_${randomBytes(9).toString('hex')}__`;
  readonly #cwd: string;
  #child: ChildProcess | undefined;
  #buffer = '';
  #waiter: ((line: RegExpMatchArray) => void) | undefined;
  #busy = false;
  #closed = false;

  private constructor(cwd: string) {
    this.#cwd = cwd;
  }

  /**
   * Start a shell.
   *
   * The sandbox wrapper is resolved once, here. A later change to sandbox
   * settings does not re-arm a shell that is already running — the tool
   * description states this, and it is why the policy is captured at open time
   * rather than read per command.
   *
   * @param opts Where to start and under what confinement.
   * @returns A ready session.
   */
  static async open(opts: ShellSessionOptions): Promise<PersistentShell> {
    const session = new PersistentShell(opts.cwd);
    // `exec` replaces the wrapper shell so signals reach bash itself; `2>&1`
    // merges the streams at the shell, preserving their true order.
    const wrapped = await wrapBashCommand({
      userCommand: 'exec /bin/bash 2>&1',
      cwd: opts.cwd,
      config: opts.sandboxConfig,
      ...(opts.sandboxDefaultMode !== undefined ? { defaultMode: opts.sandboxDefaultMode } : {}),
    });

    const child = spawn(wrapped.command, wrapped.args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Its own process group, so interrupting a command reaches the whole
      // pipeline rather than only the shell.
      detached: process.platform !== 'win32',
    });
    session.#child = child;
    child.stdout?.on('data', (c: Buffer) => session.#ingest(c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => session.#ingest(c.toString('utf8')));
    child.on('exit', () => {
      session.#closed = true;
      // Unblock anyone waiting: the sentinel is never arriving.
      session.#waiter?.(['', ''] as unknown as RegExpMatchArray);
    });
    return session;
  }

  /** Directory the shell was started in. Its current one may differ after `cd`. */
  get cwd(): string {
    return this.#cwd;
  }

  /** True once the shell has exited or been closed. */
  get closed(): boolean {
    return this.#closed;
  }

  /** True while a command is running. */
  get busy(): boolean {
    return this.#busy;
  }

  #ingest(chunk: string): void {
    this.#buffer += chunk;
    if (this.#buffer.length > MAX_OUTPUT_CHARS) {
      this.#buffer = this.#buffer.slice(this.#buffer.length - MAX_OUTPUT_CHARS);
    }
    const match = this.#buffer.match(new RegExp(`^${this.#sentinel} (-?\\d+)$`, 'm'));
    if (match) this.#waiter?.(match);
  }

  /**
   * Run one command and wait for it to finish.
   *
   * @param command Shell source to run. Multi-line is fine.
   * @param timeoutMs How long to wait before interrupting it.
   * @returns Its output and exit status, or what is known if it timed out.
   */
  async run(command: string, timeoutMs: number): Promise<ShellRunResult> {
    if (this.#closed) {
      return { output: '', exitCode: null, timedOut: false, discarded: true };
    }
    if (this.#busy) {
      throw new Error('This shell is already running a command.');
    }
    this.#busy = true;
    this.#buffer = '';
    try {
      // Braces rather than a subshell: `cd` and `export` must affect the shell
      // itself, which is the reason this class exists.
      this.#child?.stdin?.write(
        `{\n${command}\n} </dev/null\nprintf '\\n%s %s\\n' '${this.#sentinel}' "$?"\n`,
      );

      const settled = await this.#await(timeoutMs);
      if (settled) return this.#harvest(settled, false);

      // Deadline hit. Interrupt the whole process group and give the shell a
      // moment to print its sentinel; if it does, the session is still usable.
      this.#interrupt();
      const recovered = await this.#await(RECOVERY_GRACE_MS);
      if (recovered) return this.#harvest(recovered, true);

      // It never came back. A shell in an unknown state is worse than none.
      const output = this.#buffer;
      await this.close();
      return { output, exitCode: null, timedOut: true, discarded: true };
    } finally {
      this.#busy = false;
    }
  }

  /** Wait for the sentinel, or give up after `ms`. */
  #await(ms: number): Promise<RegExpMatchArray | undefined> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#waiter = undefined;
        resolve(undefined);
      }, ms);
      this.#waiter = (match) => {
        clearTimeout(timer);
        this.#waiter = undefined;
        resolve(match);
      };
    });
  }

  /** Split the sentinel line off the buffer and report the result. */
  #harvest(match: RegExpMatchArray, timedOut: boolean): ShellRunResult {
    if (this.#closed) {
      return { output: this.#buffer, exitCode: null, timedOut, discarded: true };
    }
    const at = this.#buffer.indexOf(match[0]);
    // Trailing newlines are dropped, not just the one printed ahead of the
    // sentinel. The protocol cannot tell that one apart from a newline the
    // command itself ended with, and trailing blank lines in a tool result are
    // noise every caller would strip anyway.
    const output = (at === -1 ? this.#buffer : this.#buffer.slice(0, at)).replace(/\n+$/, '');
    const code = Number(match[1]);
    return {
      output,
      exitCode: Number.isFinite(code) ? code : null,
      timedOut,
      discarded: false,
    };
  }

  /**
   * Interrupt the running command without killing the shell.
   *
   * Signalling the process group would take the shell with it: a
   * non-interactive bash terminates on SIGINT, so the session would be lost
   * every time a command overran. Signalling only the shell's children stops
   * the command — bash reports exit 130 and carries on with its state intact.
   */
  #interrupt(): void {
    const pid = this.#child?.pid;
    if (pid === undefined || process.platform === 'win32') {
      this.#child?.kill('SIGINT');
      return;
    }
    execFile('ps', ['-o', 'pid=,ppid=', '-A'], (err, stdout) => {
      if (err) return;
      for (const line of stdout.split('\n')) {
        const [child, parent] = line.trim().split(/\s+/).map(Number);
        if (parent !== pid || !Number.isFinite(child)) continue;
        try {
          process.kill(child, 'SIGINT');
        } catch {
          // Already exited between listing and signalling.
        }
      }
    });
  }

  /** Stop the shell and everything it started. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const child = this.#child;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      child.stdin?.end();
      if (process.platform !== 'win32' && child.pid !== undefined)
        process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      // Already gone.
    }
    await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 1_000))]);
    try {
      if (child.exitCode === null && process.platform !== 'win32' && child.pid !== undefined) {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch {
      // Already gone.
    }
  }
}
