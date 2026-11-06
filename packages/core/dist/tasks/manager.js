// Background tasks — the agent spawns a long-running sub-agent that runs
// concurrently with the main turn; TaskList/Get/Output/Stop/Monitor inspect
// and control it. Spec: docs/DEVELOPMENT_PLAN.md §3.15.3 (TaskCreate family).
//
// The manager is runner-agnostic: TaskCreate hands it a `runner` (the agent
// loop wires one backed by runSubAgent) which it invokes WITHOUT blocking the
// caller, piping streamed output into the task buffer and flipping status when
// it settles.
export class TaskManager {
    runner;
    tasks = new Map();
    handles = new Map();
    seq = 0;
    constructor(runner) {
        this.runner = runner;
    }
    /**
     * Replace the runner used for subsequent `create()` calls. Lets a host own a
     * long-lived (e.g. REPL session-scoped) manager while the agent loop attaches
     * its run-local sub-agent runner each turn. Tasks already started are
     * unaffected — their handle is captured at `create()` time.
     */
    setRunner(runner) {
        this.runner = runner;
    }
    newId() {
        return `task-${(this.seq++).toString(36)}`;
    }
    /** Start a background task; returns the task record immediately. */
    create(spec) {
        const id = this.newId();
        const task = {
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
            if (t && t.status === 'running')
                t.output += chunk;
        });
        handle.done.then((text) => this.settle(id, 'completed', text), (err) => this.settle(id, 'failed', `Error: ${err.message}`));
        return { ...task };
    }
    settle(id, status, finalText) {
        const t = this.tasks.get(id);
        if (!t || t.status !== 'running')
            return; // already stopped/settled
        // For non-streaming runners output is empty until now → use the final text.
        if (!t.output)
            t.output = finalText;
        t.status = status;
        t.finishedAt = new Date().toISOString();
    }
    get(id) {
        const t = this.tasks.get(id);
        return t ? { ...t } : undefined;
    }
    list() {
        return [...this.tasks.values()].map((t) => ({ ...t }));
    }
    output(id) {
        return this.tasks.get(id)?.output;
    }
    /** Abort a running task. Returns false if unknown or already finished. */
    stop(id) {
        const t = this.tasks.get(id);
        if (!t || t.status !== 'running')
            return false;
        this.handles.get(id)?.abort();
        t.status = 'stopped';
        t.finishedAt = new Date().toISOString();
        return true;
    }
    /** Update mutable task metadata (currently the description). */
    update(id, patch) {
        const t = this.tasks.get(id);
        if (!t)
            return false;
        if (patch.description !== undefined)
            t.description = patch.description;
        return true;
    }
    /** Await a task's completion (resolves immediately if already settled). */
    async wait(id) {
        const handle = this.handles.get(id);
        if (handle)
            await handle.done.catch(() => undefined);
        return this.get(id);
    }
}
//# sourceMappingURL=manager.js.map