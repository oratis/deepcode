import { PROTOCOL_VERSION, } from './types.js';
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
export class MemoryThreadStore {
    threads = new Map();
    archived = new Set();
    saveCount = 0;
    async load(threadId) {
        const thread = this.threads.get(threadId);
        return thread ? clone(thread) : null;
    }
    async save(thread) {
        this.saveCount++;
        this.threads.set(thread.id, clone(thread));
    }
    async list() {
        return [...this.threads.values()].filter((thread) => !this.archived.has(thread.id)).map(clone);
    }
    async archive(threadId) {
        this.archived.add(threadId);
    }
    async delete(threadId) {
        this.threads.delete(threadId);
        this.archived.delete(threadId);
    }
}
/** Title for a thread list row: its first user message, truncated. */
export function threadTitle(thread) {
    for (const turn of thread.turns) {
        for (const item of turn.items) {
            if (item.type !== 'user_message')
                continue;
            const text = item.payload.text;
            if (typeof text !== 'string')
                continue;
            const line = text
                .split('\n')
                .map((l) => l.trim())
                .find(Boolean);
            if (line)
                return [...line].slice(0, 60).join('');
        }
    }
    return undefined;
}
export class ProtocolInvariantError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProtocolInvariantError';
    }
}
export class ProtocolRuntime {
    options;
    now;
    newId;
    newTraceId;
    constructor(options) {
        this.options = options;
        this.now = options.now ?? (() => new Date().toISOString());
        this.newId =
            options.newId ??
                ((prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        this.newTraceId =
            options.newTraceId ??
                (() => `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    }
    initialize() {
        return {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
                threadResume: true,
                turnInterrupt: true,
                completedItemPersistence: true,
                transientDeltas: true,
                structuredToolEvents: true,
                interactiveRequests: true,
                configDiagnostics: this.options.configDiagnostics ?? false,
                runtimeCapabilities: this.options.runtimeCapabilities ?? false,
                diagnosticExport: this.options.diagnosticExport ?? false,
                workspaceDiff: this.options.workspaceDiff ?? false,
                reviewActions: this.options.reviewActions ?? false,
                reasoningDeltas: this.options.reasoningDeltas ?? false,
                threadManagement: typeof this.options.store.list === 'function' &&
                    typeof this.options.store.archive === 'function',
            },
        };
    }
    async startThread(cwd, traceId) {
        const now = this.now();
        const thread = {
            id: this.newId('thread'),
            cwd,
            createdAt: now,
            updatedAt: now,
            turns: [],
        };
        await this.options.store.save(thread);
        this.emit({ type: 'thread.started', traceId, thread: clone(thread) });
        return clone(thread);
    }
    readThread(threadId) {
        return this.options.store.load(threadId);
    }
    async resumeThread(threadId) {
        return this.requireThread(threadId);
    }
    async listThreads() {
        const list = this.options.store.list;
        if (!list)
            throw new ProtocolInvariantError('This store cannot list threads');
        const threads = await list.call(this.options.store);
        return {
            threads: threads
                .map((thread) => ({
                id: thread.id,
                cwd: thread.cwd,
                createdAt: thread.createdAt,
                updatedAt: thread.updatedAt,
                title: threadTitle(thread),
                turnCount: thread.turns.length,
            }))
                // Newest first: a picker's first row should be what you were just doing.
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        };
    }
    async archiveThread(threadId) {
        const archive = this.options.store.archive;
        if (!archive)
            throw new ProtocolInvariantError('This store cannot archive threads');
        await this.requireThread(threadId); // 404 rather than silently succeeding
        await archive.call(this.options.store, threadId);
        return { archived: true };
    }
    /**
     * Irreversibly drop a thread.
     *
     * Routed through the runtime rather than left to whoever holds a file handle:
     * the app-server is the single owner of thread storage, and a client deleting
     * files behind it can pull the ground out from under an open writer or leave
     * the index pointing at something that is gone.
     */
    async deleteThread(threadId) {
        const remove = this.options.store.delete;
        if (!remove)
            throw new ProtocolInvariantError('This store cannot delete threads');
        await this.requireThread(threadId); // 404 rather than silently succeeding
        await remove.call(this.options.store, threadId);
        return { deleted: true };
    }
    /**
     * Copy a thread into a new one, leaving the original untouched.
     *
     * An in-progress turn is copied as `interrupted`: the fork is a new thread
     * that nothing is executing, and carrying `in_progress` across would make it
     * permanently refuse to start a turn.
     */
    async forkThread(threadId, traceId) {
        const source = await this.requireThread(threadId);
        const now = this.now();
        const fork = {
            id: this.newId('thread'),
            cwd: source.cwd,
            createdAt: now,
            updatedAt: now,
            turns: source.turns.map((turn) => ({
                ...clone(turn),
                status: turn.status === 'in_progress' ? 'interrupted' : turn.status,
            })),
        };
        await this.options.store.save(fork);
        this.emit({ type: 'thread.started', traceId, thread: clone(fork) });
        return clone(fork);
    }
    async startTurn(threadId, input, traceId = this.newTraceId()) {
        const thread = await this.requireThread(threadId);
        if (thread.turns.some((turn) => turn.status === 'in_progress')) {
            throw new ProtocolInvariantError(`Thread ${threadId} already has an active turn`);
        }
        const now = this.now();
        const inputItem = this.completedItem('user_message', input, now);
        const turn = {
            id: this.newId('turn'),
            traceId,
            threadId,
            status: 'in_progress',
            startedAt: now,
            items: [inputItem],
        };
        thread.turns.push(turn);
        thread.updatedAt = now;
        await this.options.store.save(thread);
        this.emit({ type: 'turn.started', traceId, threadId, turn: clone(turn) });
        this.emit({
            type: 'item.completed',
            traceId,
            threadId,
            turnId: turn.id,
            item: clone(inputItem),
        });
        return clone(turn);
    }
    async appendCompletedItem(threadId, turnId, type, payload) {
        const thread = await this.requireThread(threadId);
        const turn = this.requireTurn(thread, turnId);
        if (turn.status !== 'in_progress') {
            throw new ProtocolInvariantError(`Cannot append to terminal turn ${turnId}`);
        }
        const item = this.completedItem(type, payload, this.now());
        turn.items.push(item);
        thread.updatedAt = item.completedAt;
        await this.options.store.save(thread);
        this.emit({
            type: 'item.completed',
            traceId: turn.traceId,
            threadId,
            turnId,
            item: clone(item),
        });
        return clone(item);
    }
    publishDelta(event) {
        this.emit({ type: 'item.delta', ...event });
    }
    /** Reasoning stream — transient like item.delta, never persisted as an item. */
    publishReasoning(event) {
        this.emit({ type: 'reasoning.delta', ...event });
    }
    completeTurn(threadId, turnId) {
        return this.finishTurn(threadId, turnId, 'completed');
    }
    interruptTurn(threadId, turnId) {
        return this.finishTurn(threadId, turnId, 'interrupted');
    }
    failTurn(threadId, turnId) {
        return this.finishTurn(threadId, turnId, 'failed');
    }
    async finishTurn(threadId, turnId, requested) {
        const thread = await this.requireThread(threadId);
        const turn = this.requireTurn(thread, turnId);
        if (turn.status !== 'in_progress')
            return clone(turn);
        const now = this.now();
        turn.status = requested;
        turn.completedAt = now;
        thread.updatedAt = now;
        await this.options.store.save(thread);
        const type = requested === 'completed'
            ? 'turn.completed'
            : requested === 'interrupted'
                ? 'turn.interrupted'
                : 'turn.failed';
        this.emit({ type, traceId: turn.traceId, threadId, turn: clone(turn) });
        return clone(turn);
    }
    async requireThread(threadId) {
        const thread = await this.options.store.load(threadId);
        if (!thread)
            throw new ProtocolInvariantError(`Thread not found: ${threadId}`);
        return thread;
    }
    requireTurn(thread, turnId) {
        const turn = thread.turns.find((candidate) => candidate.id === turnId);
        if (!turn)
            throw new ProtocolInvariantError(`Turn not found: ${turnId}`);
        return turn;
    }
    completedItem(type, payload, completedAt) {
        return { id: this.newId('item'), type, payload: clone(payload), completedAt };
    }
    emit(event) {
        this.options.onEvent?.(event);
    }
}
export class ProtocolRecorder {
    records = [];
    record(event) {
        if (isDurableEvent(event))
            this.records.push(clone(event));
    }
    replay(consumer) {
        for (const event of this.records)
            consumer(clone(event));
    }
    snapshot() {
        return clone(this.records);
    }
}
function isDurableEvent(event) {
    return (event.type === 'thread.started' ||
        event.type === 'turn.started' ||
        event.type === 'item.completed' ||
        event.type === 'turn.completed' ||
        event.type === 'turn.interrupted' ||
        event.type === 'turn.failed');
}
//# sourceMappingURL=runtime.js.map