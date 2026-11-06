import type { ThreadSnapshot, ThreadStore } from '@deepcode/protocol';
export declare class FileThreadStore implements ThreadStore {
    readonly directory: string;
    private sequence;
    constructor(directory: string);
    load(threadId: string): Promise<ThreadSnapshot | null>;
    save(thread: ThreadSnapshot): Promise<void>;
    list(): Promise<ThreadSnapshot[]>;
    archive(threadId: string): Promise<void>;
    delete(threadId: string): Promise<void>;
    private pathFor;
}
/**
 * Rich protocol snapshots plus a canonical session-v1 message projection.
 *
 * The protocol snapshot preserves lifecycle/items. The canonical projection
 * keeps the existing CLI/desktop session index and legacy readers continuous
 * during rollout. Both use the same id, and legacy-only sessions are imported
 * lazily the first time the app-server resumes them.
 */
export declare class CanonicalThreadStore implements ThreadStore {
    private readonly snapshots;
    private readonly sessions;
    constructor(snapshotDirectory: string, sessionsDirectory: string);
    load(threadId: string): Promise<ThreadSnapshot | null>;
    save(thread: ThreadSnapshot): Promise<void>;
    /**
     * Snapshots first, then any legacy session that has no snapshot yet — so a
     * listing shows everything a user has, not just what the app-server has
     * touched since 0.2.0. Legacy rows are projected lazily and not written.
     */
    list(): Promise<ThreadSnapshot[]>;
    archive(threadId: string): Promise<void>;
    /**
     * Drop both representations of a thread.
     *
     * The snapshot and the canonical session projection share an id and are two
     * views of one thing, so removing one and leaving the other is how a deleted
     * thread comes back in the next listing — the composite `list` reads both.
     */
    delete(threadId: string): Promise<void>;
}
//# sourceMappingURL=store.d.ts.map