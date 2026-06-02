// Worktree subsystem — git worktree creation + tear-down for isolated agent runs.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 (M8)
//
// Why: background tasks and risky refactors run in a temporary git worktree so
// they can't corrupt the user's main checkout. EnterWorktree() creates one;
// ExitWorktree() removes it. Supports baseRef, symlinkDirectories,
// sparsePaths from settings.worktree.

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import type { WorktreeConfig } from '../config/types.js';
import { gitSpawnEnv } from '../util/git-env.js';

export interface WorktreeHandle {
  /** Absolute path to the worktree dir. */
  path: string;
  /** The branch name (created in the source repo). */
  branch: string;
  /** Source repo path. */
  source: string;
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
export async function createWorktree(opts: CreateWorktreeOpts): Promise<WorktreeHandle> {
  const source = opts.source;
  await assertGitRepo(source);
  const parent = opts.parentDir ?? tmpdir();
  const branch =
    opts.branch ?? `dc/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const path = join(parent, `dc-wt-${basename(source)}-${branch.replace(/[/]/g, '_')}`);
  const baseRef = opts.config?.baseRef ?? 'HEAD';

  // git worktree add -b <branch> <path> <baseRef>
  runGit(source, ['worktree', 'add', '-b', branch, path, baseRef]);

  // Sparse checkout: limit to listed paths
  if (opts.config?.sparsePaths && opts.config.sparsePaths.length > 0) {
    runGit(path, ['sparse-checkout', 'init', '--cone']);
    runGit(path, ['sparse-checkout', 'set', ...opts.config.sparsePaths]);
  }

  // Symlinks: e.g. node_modules → source/node_modules
  for (const dir of opts.config?.symlinkDirectories ?? []) {
    const src = join(source, dir);
    const dst = join(path, dir);
    try {
      await fs.access(src);
    } catch {
      continue; // skip if source doesn't have the dir
    }
    try {
      await fs.rm(dst, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    await fs.symlink(src, dst, 'dir');
  }

  return { path, branch, source };
}

/**
 * Remove a worktree (git worktree remove + delete the branch).
 * Idempotent: silently no-ops if path is already gone.
 */
export async function removeWorktree(handle: WorktreeHandle): Promise<void> {
  try {
    await fs.access(handle.path);
  } catch {
    return;
  }
  runGit(handle.source, ['worktree', 'remove', '--force', handle.path]);
  // Delete the branch (best-effort)
  spawnSync('git', ['-C', handle.source, 'branch', '-D', handle.branch], {
    stdio: 'pipe',
    env: gitSpawnEnv(),
  });
}

function runGit(cwd: string, args: string[]): void {
  // gitSpawnEnv() strips GIT_* vars the parent may have set (e.g. when running
  // inside a `git commit` hook); otherwise they hijack cwd resolution and we
  // operate on the wrong repo's index. See git-env.ts.
  const r = spawnSync('git', ['-C', cwd, ...args], {
    stdio: 'pipe',
    encoding: 'utf8',
    env: gitSpawnEnv(),
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  }
}

async function assertGitRepo(path: string): Promise<void> {
  try {
    await fs.access(join(path, '.git'));
  } catch {
    throw new Error(`${path} is not a git repository (no .git dir).`);
  }
}
