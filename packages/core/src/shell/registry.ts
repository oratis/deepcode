// Owner of every open shell, and the thing that guarantees none outlive their run.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.4
//
// A long-lived process is a leak waiting to happen. Two rules keep it bounded:
// the registry closes everything when its owner ends, and an idle shell closes
// itself. Neither is optional — a crashed session leaving orphaned shells on the
// machine is exactly the objection this capability has to answer.

import { PersistentShell, type ShellSessionOptions } from './session.js';

/** An open shell and what a caller is allowed to know about it. */
export interface ShellInfo {
  id: string;
  /** Directory it started in. */
  cwd: string;
  /** ISO timestamp of the last command run in it. */
  lastUsedAt: string;
  busy: boolean;
}

export interface ShellRegistryOptions {
  /** Close a shell after this long without a command. Defaults to 30 minutes. */
  idleTimeoutMs?: number;
  /** Maximum shells open at once. Defaults to 8. */
  maxShells?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_MAX_SHELLS = 8;

interface Entry {
  shell: PersistentShell;
  cwd: string;
  lastUsedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Every shell open for one agent session. */
export class ShellRegistry {
  readonly #entries = new Map<string, Entry>();
  readonly #idleTimeoutMs: number;
  readonly #maxShells: number;
  #seq = 0;

  /**
   * @param opts Idle timeout and concurrency cap.
   */
  constructor(opts: ShellRegistryOptions = {}) {
    this.#idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.#maxShells = opts.maxShells ?? DEFAULT_MAX_SHELLS;
  }

  /**
   * Open a shell.
   *
   * @param opts Where to start it and under what confinement.
   * @returns The new shell's id.
   * @throws When the concurrency cap is already reached.
   */
  async open(opts: ShellSessionOptions): Promise<string> {
    this.#reap();
    if (this.#entries.size >= this.#maxShells) {
      throw new Error(
        `Too many shells open (${this.#entries.size}/${this.#maxShells}). Close one with ShellClose first.`,
      );
    }
    const id = `shell-${++this.#seq}`;
    const shell = await PersistentShell.open(opts);
    this.#entries.set(id, {
      shell,
      cwd: opts.cwd,
      lastUsedAt: Date.now(),
      timer: this.#armIdle(id),
    });
    return id;
  }

  /**
   * Look up a live shell.
   *
   * @param id Shell id.
   * @returns The shell, or undefined when it is unknown or already gone.
   */
  get(id: string): PersistentShell | undefined {
    const entry = this.#entries.get(id);
    if (!entry) return undefined;
    if (entry.shell.closed) {
      this.#forget(id);
      return undefined;
    }
    return entry.shell;
  }

  /** Record activity on a shell and restart its idle countdown. */
  touch(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.lastUsedAt = Date.now();
    clearTimeout(entry.timer);
    entry.timer = this.#armIdle(id);
  }

  /** Every open shell, oldest first. */
  list(): ShellInfo[] {
    this.#reap();
    return [...this.#entries.entries()].map(([id, e]) => ({
      id,
      cwd: e.cwd,
      lastUsedAt: new Date(e.lastUsedAt).toISOString(),
      busy: e.shell.busy,
    }));
  }

  /**
   * Close one shell.
   *
   * @param id Shell id.
   * @returns True when a shell was closed, false when the id was unknown.
   */
  async close(id: string): Promise<boolean> {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    this.#forget(id);
    await entry.shell.close();
    return true;
  }

  /** Close everything. Called when the owning run or session ends. */
  async closeAll(): Promise<void> {
    const entries = [...this.#entries.keys()];
    await Promise.all(entries.map((id) => this.close(id)));
  }

  #armIdle(id: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      void this.close(id);
    }, this.#idleTimeoutMs);
    // An idle shell must not be the reason the process stays alive.
    timer.unref?.();
    return timer;
  }

  #forget(id: string): void {
    const entry = this.#entries.get(id);
    if (entry) clearTimeout(entry.timer);
    this.#entries.delete(id);
  }

  /** Drop entries whose shell exited on its own. */
  #reap(): void {
    for (const [id, entry] of this.#entries) {
      if (entry.shell.closed) this.#forget(id);
    }
  }
}
