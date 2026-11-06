import type { WorktreeConfig } from '../config/types.js';
export interface WorktreeHandle {
    /** Absolute path to the worktree dir. */
    path: string;
    /** The branch name (created in the source repo). */
    branch: string;
    /** Source repo path. */
    source: string;
    /** Untracked symlinks created by DeepCode and safe to unlink on removal. */
    managedSymlinks?: string[];
}
export interface CreateWorktreeOpts {
    /** Source repo root (must contain .git). */
    source: string;
    /** Optional branch name; defaults to `dc/<random>`. */
    branch?: string;
    /** Optional dir to create the worktree under; defaults to system tmp. */
    parentDir?: string;
    /** WorktreeConfig from settings. */
    config?: WorktreeConfig;
}
/**
 * Create a git worktree branched from `baseRef` (HEAD by default). Honors
 * `symlinkDirectories` (e.g. node_modules) and `sparsePaths` (sparse-checkout
 * narrowed to these paths only).
 */
export declare function createWorktree(opts: CreateWorktreeOpts): Promise<WorktreeHandle>;
/**
 * Remove a clean worktree while retaining its branch for recovery or review.
 * Idempotent: silently no-ops if path is already gone.
 * Dirty or untracked worktrees are rejected by Git and left intact.
 */
export declare function removeWorktree(handle: WorktreeHandle): Promise<void>;
//# sourceMappingURL=index.d.ts.map