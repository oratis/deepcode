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
export declare class TaskManager {
    private runner;
    private readonly tasks;
    private readonly handles;
    private seq;
    constructor(runner: TaskRunner);
    /**
     * Replace the runner used for subsequent `create()` calls. Lets a host own a
     * long-lived (e.g. REPL session-scoped) manager while the agent loop attaches
     * its run-local sub-agent runner each turn. Tasks already started are
     * unaffected — their handle is captured at `create()` time.
     */
    setRunner(runner: TaskRunner): void;
    private newId;
    /** Start a background task; returns the task record immediately. */
    create(spec: CreateTaskSpec): Task;
    private settle;
    get(id: string): Task | undefined;
    list(): Task[];
    output(id: string): string | undefined;
    /** Abort a running task. Returns false if unknown or already finished. */
    stop(id: string): boolean;
    /** Update mutable task metadata (currently the description). */
    update(id: string, patch: {
        description?: string;
    }): boolean;
    /** Await a task's completion (resolves immediately if already settled). */
    wait(id: string): Promise<Task | undefined>;
}
//# sourceMappingURL=manager.d.ts.map