import type { StoredMessage } from '../types.js';
export type SessionFormat = 'canonical-v1' | 'core-v0' | 'desktop-v0' | 'empty';
export interface SessionDiagnostic {
    line: number;
    code: 'truncated_tail' | 'invalid_json' | 'invalid_message';
    message: string;
    fatal: boolean;
}
export interface SessionReadResult {
    format: SessionFormat;
    meta: SessionMeta | null;
    messages: StoredMessage[];
    diagnostics: SessionDiagnostic[];
}
export declare class SessionCorruptionError extends Error {
    readonly sessionId: string;
    readonly diagnostics: SessionDiagnostic[];
    constructor(sessionId: string, diagnostics: SessionDiagnostic[]);
}
export declare class SessionWriterConflictError extends Error {
    readonly sessionId: string;
    constructor(sessionId: string);
}
export interface SessionMeta {
    id: string;
    cwd: string;
    createdAt: string;
    updatedAt: string;
    model?: string;
    title?: string;
}
export declare function defaultSessionsDir(): string;
export interface SessionFiles {
    /** Read-only core v0 metadata sidecar. */
    metaPath: string;
    /** Canonical v1 stream used for all new writes. */
    jsonlPath: string;
    /** Read-only core/desktop v0 stream. */
    legacyJsonlPath: string;
    writerLockPath: string;
    snapshotsDir: string;
}
/**
 * Irreversibly remove every file belonging to one session.
 *
 * Both stream formats, the metadata sidecar, the writer lock and the snapshot
 * directory. Leaving any of them behind is not a tidy half-delete: the listing
 * reads the meta sidecar, so a session whose stream is gone but whose sidecar
 * remains comes back as an empty row that cannot be opened.
 *
 * Missing files are not an error. The caller has already established that the
 * session exists, and a delete that fails partway through because one of five
 * paths was already gone leaves the user unable to finish it.
 *
 * A malformed id *is* an error, and is refused before anything is removed. The
 * callers in-tree all validate first, so this can only fire on a programming
 * mistake — which is exactly when a recursive delete resolved from an untrusted
 * string must not proceed on the strength of somebody else having checked.
 */
export declare function deleteSession(root: string, sessionId: string): Promise<void>;
export declare function sessionFiles(root: string, sessionId: string): SessionFiles;
export declare function writeMeta(root: string, meta: SessionMeta): Promise<void>;
export declare function readMeta(root: string, sessionId: string): Promise<SessionMeta | null>;
export declare function appendMessage(root: string, sessionId: string, message: StoredMessage): Promise<void>;
/**
 * Atomically materialize the complete canonical session projection.
 *
 * Protocol stores use this idempotent full rewrite while their richer lifecycle
 * snapshot remains the source of truth. A title written by another compatible
 * client is always preserved; explicit rename continues to use `writeMeta`.
 */
export declare function replaceSession(root: string, meta: SessionMeta, messages: StoredMessage[]): Promise<void>;
export declare function readMessages(root: string, sessionId: string): Promise<StoredMessage[]>;
/** Parse both historical JSONL layouts without modifying either one. */
export declare function readSessionRecords(root: string, sessionId: string): Promise<SessionReadResult>;
export declare function listSessions(root: string): Promise<SessionMeta[]>;
export declare function newSessionId(): string;
//# sourceMappingURL=storage.d.ts.map