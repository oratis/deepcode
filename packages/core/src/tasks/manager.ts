// Background tasks — the agent spawns a long-running sub-agent that runs
// concurrently with the main turn; TaskList/Get/Output/Stop/Monitor inspect
// and control it. Spec: docs/DEVELOPMENT_PLAN.md §3.15.3 (TaskCreate family).
//
// The manager is runner-agnostic: TaskCreate hands it a `runner` (the agent
// loop wires one backed by runSubAgent) which it invokes WITHOUT blocking the
// caller, piping streamed output into the task buffer and flipping status when
// it settles.

export type TaskStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  /** Accumulated output (streamed chunks for a live runner, else final text). */
  output: string;
  createdAt: string;
  finishedAt?: string;
}

export interface TaskRunHandle {
  /** Resolves with the task's final text when the run completes. */
  done: Promise<string>;
  /** Abort the run (best-effort). */
  abort: () => void;
  /** Register a streamed-output sink (optional — runners may not stream). */
  onChunk?: (cb: (chunk: string) => void) => void;
}

export interface CreateTaskSpec {
  description: string;
  prompt: string;
  agentType?: string;
}

/** Runner the host supplies: starts the work and returns a handle. */
export type TaskRunner = (spec: CreateTaskSpec) => TaskRunHandle;

export class TaskManager {
  private readonly tasks = new Map<string, Task>();
  private readonly handles = new Map<string, TaskRunHandle>();
  private seq = 0;

  constructor(private runner: TaskRunner) {}

  /**
   * Replace the runner used for subsequent `create()` calls. Lets a host own a
   * long-lived (e.g. REPL session-scoped) manager while the agent loop attaches
   * its run-local sub-agent runner each turn. Tasks already started are
   * unaffected — their handle is captured at `create()` time.
   */
  setRunner(runner: TaskRunner): void {
    this.runner = runner;
  }

  private newId(): string {
    return `task-${(this.seq++).toString(36)}`;
  }

  /** Start a background task; returns the task record immediately. */
  create(spec: CreateTaskSpec): Task {
    const id = this.newId();
    const task: Task = {
      id,
      description: spec.description,
      status: 'running',
      output: '',
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(id, task);
    const handle = this.runner(spec);
    this.handles.set(id, handle);
    handle.onChunk?.((chunk) => {
      const t = this.tasks.get(id);
      if (t && t.status === 'running') t.output += chunk;
    });
    handle.done.then(
      (text) => this.settle(id, 'completed', text),
      (err) => this.settle(id, 'failed', `Error: ${(err as Error).message}`),
    );
    return { ...task };
  }

  private settle(id: string, status: TaskStatus, finalText: string): void {
    const t = this.tasks.get(id);
    if (!t || t.status !== 'running') return; // already stopped/settled
    // For non-streaming runners output is empty until now → use the final text.
    if (!t.output) t.output = finalText;
    t.status = status;
    t.finishedAt = new Date().toISOString();
  }

  get(id: string): Task | undefined {
    const t = this.tasks.get(id);
    return t ? { ...t } : undefined;
  }

  list(): Task[] {
    return [...this.tasks.values()].map((t) => ({ ...t }));
  }

  output(id: string): string | undefined {
    return this.tasks.get(id)?.output;
  }

  /** Abort a running task. Returns false if unknown or already finished. */
  stop(id: string): boolean {
    const t = this.tasks.get(id);
    if (!t || t.status !== 'running') return false;
    this.handles.get(id)?.abort();
    t.status = 'stopped';
    t.finishedAt = new Date().toISOString();
    return true;
  }

  /** Update mutable task metadata (currently the description). */
  update(id: string, patch: { description?: string }): boolean {
    const t = this.tasks.get(id);
    if (!t) return false;
    if (patch.description !== undefined) t.description = patch.description;
    return true;
  }

  /** Await a task's completion (resolves immediately if already settled). */
  async wait(id: string): Promise<Task | undefined> {
    const handle = this.handles.get(id);
    if (handle) await handle.done.catch(() => undefined);
    return this.get(id);
  }
}
