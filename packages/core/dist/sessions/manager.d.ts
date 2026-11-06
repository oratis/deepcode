import type { StoredMessage } from '../types.js';
import { type SessionMeta } from './storage.js';
import { type Snapshot } from './snapshots.js';
export interface SessionManagerOpts {
    root?: string;
}
export declare class SessionManager {
    readonly root: string;
    constructor(opts?: SessionManagerOpts);
    create(cwd: string, opts?: {
        title?: string;
        model?: string;
    }): Promise<SessionMeta>;
    load(sessionId: string): Promise<{
        meta: SessionMeta;
        messages: StoredMessage[];
    } | null>;
    append(sessionId: string, msg: StoredMessage): Promise<void>;
    materialize(meta: SessionMeta, messages: StoredMessage[]): Promise<void>;
    list(): Promise<SessionMeta[]>;
    delete(sessionId: string): Promise<void>;
    snapshot(args: {
        sessionId: string;
        cwd: string;
        filePath: string;
        reason: string;
        seq: number;
        turnId?: string;
    }): Promise<Snapshot | null>;
    /** Capture a git working-tree checkpoint (used before Bash commands). */
    gitCheckpoint(args: {
        sessionId: string;
        cwd: string;
        reason: string;
        seq: number;
        turnId?: string;
    }): Promise<Snapshot | null>;
    snapshots(sessionId: string): Promise<Snapshot[]>;
}
//# sourceMappingURL=manager.d.ts.map