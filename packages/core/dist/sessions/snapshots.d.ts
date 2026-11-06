export interface Snapshot {
    filePath: string;
    capturedAt: string;
    /** Numeric projection used by thin clients; absent on older manifests. */
    capturedAtMs?: number;
    reason: string;
    hash: string;
    size: number;
    /** Sequential within the session. */
    seq: number;
    /** Canonical app-server turn that caused this snapshot, when available. */
    turnId?: string;
    /** Whether the file existed before capture; absent on legacy manifests. */
    existed?: boolean;
    /** Absolute path on disk where the snapshot blob is stored ('' for git kind). */
    blobPath: string;
    /**
     * 'file' (default) — a single-file blob (Edit/Write). 'git' — a working-tree
     * checkpoint (for Bash, whose mutated files aren't known ahead of time);
     * restored by `git checkout <gitRef> -- <changed files>`.
     */
    kind?: 'file' | 'git';
    /** For kind 'git': the commit-ish capturing the pre-command working tree. */
    gitRef?: string;
}
export declare function snapshotsDirFor(sessionsRoot: string, sessionId: string): string;
/** Capture the current state of a file as a snapshot. */
export declare function captureSnapshot(args: {
    sessionsRoot: string;
    sessionId: string;
    cwd: string;
    filePath: string;
    reason: string;
    seq: number;
    turnId?: string;
}): Promise<Snapshot | null>;
/**
 * Capture a git working-tree checkpoint before a Bash command. Unlike per-file
 * snapshots, the set of files a shell command touches isn't known in advance, so
 * we record a commit-ish (`git stash create`, or HEAD if the tree is clean) that
 * captures the current TRACKED state. Restoring re-checks-out the files that
 * changed since. No-op (returns null) outside a git work tree or in a repo with
 * no commits. NOTE: untracked files created by the command aren't captured.
 */
export declare function captureGitCheckpoint(args: {
    sessionsRoot: string;
    sessionId: string;
    cwd: string;
    reason: string;
    seq: number;
    turnId?: string;
}): Promise<Snapshot | null>;
export declare function listSnapshots(args: {
    sessionsRoot: string;
    sessionId: string;
}): Promise<Snapshot[]>;
/**
 * Restore a snapshot. For a 'file' snapshot, write its blob back. For a 'git'
 * checkpoint, `git checkout <ref> -- <files changed since>` in the repo —
 * reverting tracked files the command modified back to the checkpoint state.
 * Returns the list of restored paths (the single file for blobs).
 */
export declare function restoreSnapshot(snap: Snapshot): Promise<string[]>;
//# sourceMappingURL=snapshots.d.ts.map