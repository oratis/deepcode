/**
 * Two timelines, deliberately.
 *
 * `changes` is high-frequency workspace edits — the "what did it do" stream.
 * `governance` is low-frequency, high-impact: contract edits, plugin installs,
 * trust grants, rollbacks. Interleaving them buries the second in the first,
 * which is the whole reason to keep the split rather than one file with a type
 * column: the rare, important events stay readable on their own.
 */
export type LedgerKind = 'changes' | 'governance';
export declare const LEDGER_KINDS: readonly LedgerKind[];
export interface RollbackHint {
    /** `git` when a repo checkpoint exists, `snapshot` for per-file captures. */
    kind: 'git' | 'snapshot' | 'manual';
    /** Commit-ish, snapshot address, or a human instruction for `manual`. */
    ref?: string;
    /** Ready-to-run command, when one exists. */
    command?: string;
}
export interface LedgerRecord {
    id: string;
    /** ISO 8601. */
    timestamp: string;
    /** `user` | `agent` | `hook` | `plugin` | `subagent:<name>`. */
    actor: string;
    threadId?: string;
    turnId?: string;
    /** Tool that produced the change, when one did. */
    tool?: string;
    /** What the run was trying to achieve — the user's request, abridged. */
    intent?: string;
    /** Workspace-relative paths. Empty when the effect cannot be pinned to files. */
    paths: string[];
    /**
     * Workspace-relative paths this turn read before making this change.
     *
     * The ledger already answers "what changed" and "how do I undo it". This
     * answers "what was it derived from" — the question you ask when a generated
     * file is wrong and you need to know which input to fix, or when a secret
     * turns up somewhere and you need to know what the turn had open.
     *
     * Observed, not declared: these are the reads the turn actually performed, so
     * a tool that ignored its inputs shows an empty list rather than a plausible
     * one. Absent on records written before this existed, and on turns that read
     * nothing.
     */
    derivedFrom?: string[];
    summary: string;
    rollbackHint?: RollbackHint;
}
export type NewLedgerRecord = Omit<LedgerRecord, 'id' | 'timestamp'>;
/**
 * Where the agent loop writes. An interface so a host can substitute one, and
 * so tests need no filesystem.
 */
export interface LedgerSink {
    append(kind: LedgerKind, record: NewLedgerRecord): Promise<LedgerRecord | null>;
}
export interface LedgerRetention {
    /** Newest records to keep per file. */
    maxRecords: number;
    /** Drop records older than this. */
    maxAgeDays: number;
}
export declare const DEFAULT_RETENTION: LedgerRetention;
/**
 * Ledgers live under the DeepCode data dir, keyed by project — not in the
 * repository.
 *
 * Selfware keeps its change log inside the instance, which suits a document
 * workspace. Here it would append to a tracked file on every edit and turn
 * `git status` into noise during the exact activity the user is reviewing.
 * `deepcode ledger export` covers the case where they do want it committed.
 */
export declare function projectLedgerDir(cwd: string, home?: string): string;
export declare function ledgerPath(cwd: string, kind: LedgerKind, home?: string): string;
export declare function newLedgerId(now?: number): string;
export interface FileLedgerOpts {
    cwd: string;
    home?: string;
    retention?: Partial<LedgerRetention>;
    /** Clock injection for tests. */
    now?: () => Date;
}
export declare class FileLedger implements LedgerSink {
    private readonly opts;
    private readonly retention;
    private readonly now;
    /** Appends since the last prune check, per kind. */
    private readonly sinceCheck;
    constructor(opts: FileLedgerOpts);
    path(kind: LedgerKind): string;
    /**
     * Append one record. Returns it, or null if it could not be written.
     *
     * Never throws. A ledger is an audit trail, not a precondition — failing a
     * tool call because bookkeeping failed would trade a working edit for a lost
     * one. Failures surface through `lastError`.
     */
    append(kind: LedgerKind, record: NewLedgerRecord): Promise<LedgerRecord | null>;
    lastError?: Error;
    /**
     * Trim to the retention window: newest `maxRecords`, nothing older than
     * `maxAgeDays`.
     *
     * Retention ships with the writer rather than as a follow-up. A log that only
     * ever grows is a log someone eventually deletes wholesale, which loses the
     * old records the retention policy would have kept anyway.
     */
    prune(kind: LedgerKind): Promise<number>;
}
/**
 * Read a ledger file, skipping unparseable lines.
 *
 * A corrupt line here is not worth failing over: unlike a session, no later
 * state is reconstructed from these records, so the readable ones stay useful
 * on their own.
 */
export declare function readLedger(path: string): Promise<LedgerRecord[]>;
export declare function readProjectLedger(cwd: string, kind: LedgerKind, home?: string): Promise<LedgerRecord[]>;
/** Find one record by id across both timelines. */
export declare function findLedgerRecord(cwd: string, id: string, home?: string): Promise<{
    kind: LedgerKind;
    record: LedgerRecord;
} | null>;
/** Render records as a human-readable Markdown digest. */
export declare function renderLedgerMarkdown(kind: LedgerKind, records: LedgerRecord[]): string;
//# sourceMappingURL=index.d.ts.map