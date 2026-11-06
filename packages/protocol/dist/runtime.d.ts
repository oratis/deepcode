import { type CompletedItem, type CompletedItemType, type DurableProtocolEvent, type InitializeResult, type ProtocolEvent, type ReasoningDeltaEvent, type ThreadListResult, type ThreadSnapshot, type TransientDeltaEvent, type TurnSnapshot } from './types.js';
export interface ThreadStore {
    load(threadId: string): Promise<ThreadSnapshot | null>;
    save(thread: ThreadSnapshot): Promise<void>;
    /**
     * Optional: listing and archiving need an index the base store doesn't have.
     * A store without them leaves `threadManagement` off, and the runtime rejects
     * the calls rather than pretending an empty list is the truth.
     */
    list?(): Promise<ThreadSnapshot[]>;
    archive?(threadId: string): Promise<void>;
    /**
     * Optional: irreversibly drop a thread.
     *
     * Separate from `archive` because the two are different promises, and a store
     * that can move a file is not necessarily one that should be asked to destroy
     * it. A store without this leaves the call rejected rather than silently
     * archiving instead — quietly downgrading a delete would be the worst way to
     * be helpful about it.
     */
    delete?(threadId: string): Promise<void>;
}
export declare class MemoryThreadStore implements ThreadStore {
    private readonly threads;
    private readonly archived;
    saveCount: number;
    load(threadId: string): Promise<ThreadSnapshot | null>;
    save(thread: ThreadSnapshot): Promise<void>;
    list(): Promise<ThreadSnapshot[]>;
    archive(threadId: string): Promise<void>;
    delete(threadId: string): Promise<void>;
}
export interface ProtocolRuntimeOptions {
    store: ThreadStore;
    now?: () => string;
    newId?: (prefix: 'thread' | 'turn' | 'item') => string;
    newTraceId?: () => string;
    onEvent?: (event: ProtocolEvent) => void;
    configDiagnostics?: boolean;
    runtimeCapabilities?: boolean;
    diagnosticExport?: boolean;
    workspaceDiff?: boolean;
    reviewActions?: boolean;
    reasoningDeltas?: boolean;
}
/** Title for a thread list row: its first user message, truncated. */
export declare function threadTitle(thread: ThreadSnapshot): string | undefined;
export declare class ProtocolInvariantError extends Error {
    constructor(message: string);
}
export declare class ProtocolRuntime {
    private readonly options;
    private readonly now;
    private readonly newId;
    private readonly newTraceId;
    constructor(options: ProtocolRuntimeOptions);
    initialize(): InitializeResult;
    startThread(cwd: string, traceId?: string): Promise<ThreadSnapshot>;
    readThread(threadId: string): Promise<ThreadSnapshot | null>;
    resumeThread(threadId: string): Promise<ThreadSnapshot>;
    listThreads(): Promise<ThreadListResult>;
    archiveThread(threadId: string): Promise<{
        archived: boolean;
    }>;
    /**
     * Irreversibly drop a thread.
     *
     * Routed through the runtime rather than left to whoever holds a file handle:
     * the app-server is the single owner of thread storage, and a client deleting
     * files behind it can pull the ground out from under an open writer or leave
     * the index pointing at something that is gone.
     */
    deleteThread(threadId: string): Promise<{
        deleted: boolean;
    }>;
    /**
     * Copy a thread into a new one, leaving the original untouched.
     *
     * An in-progress turn is copied as `interrupted`: the fork is a new thread
     * that nothing is executing, and carrying `in_progress` across would make it
     * permanently refuse to start a turn.
     */
    forkThread(threadId: string, traceId?: string): Promise<ThreadSnapshot>;
    startTurn(threadId: string, input: Record<string, unknown>, traceId?: string): Promise<TurnSnapshot>;
    appendCompletedItem(threadId: string, turnId: string, type: CompletedItemType, payload: Record<string, unknown>): Promise<CompletedItem>;
    publishDelta(event: Omit<TransientDeltaEvent, 'type'>): void;
    /** Reasoning stream — transient like item.delta, never persisted as an item. */
    publishReasoning(event: Omit<ReasoningDeltaEvent, 'type'>): void;
    completeTurn(threadId: string, turnId: string): Promise<TurnSnapshot>;
    interruptTurn(threadId: string, turnId: string): Promise<TurnSnapshot>;
    failTurn(threadId: string, turnId: string): Promise<TurnSnapshot>;
    private finishTurn;
    private requireThread;
    private requireTurn;
    private completedItem;
    private emit;
}
export declare class ProtocolRecorder {
    private readonly records;
    record(event: ProtocolEvent): void;
    replay(consumer: (event: DurableProtocolEvent) => void): void;
    snapshot(): DurableProtocolEvent[];
}
//# sourceMappingURL=runtime.d.ts.map