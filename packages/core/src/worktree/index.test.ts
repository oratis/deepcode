import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorktree, removeWorktree } from './index.js';

/**
 * On macOS `mkdtemp(tmpdir())` returns a path under `/var/folders/...` which
 * is a symlink to `/private/var/folders/...`. git mixes the two
 * representations across operations (config vs index vs worktree registry)
 * and ends up confused — `git worktree add` from the symlinked source path
 * fails with `.git/index: index file open failed: Not a directory`.
 * Calling `realpath` here forces every path we hand to git to be canonical.
 */
async function canonicalMkdtemp(prefix: string): Promise<string> {
  const raw = await mkdtemp(join(tmpdir(), prefix));
  return await realpath(raw);
}

/**
 * Strip git env vars that the parent process (e.g. a `git commit` driving a
 * husky pre-commit hook) may have set. Without this, `GIT_DIR` / `GIT_WORK_TREE`
 * / `GIT_INDEX_FILE` from the outer commit leak into child `git` invocations
 * and they try to operate on the outer repo's index — failing with
 * `.git/index: index file open failed: Not a directory`.
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('GIT_')) delete env[k];
  }
  return env;
}

function runOrFail(cmd: string, args: string[], cwd: string): void {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: cleanGitEnv() });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status}): ${r.stderr || r.stdout}`);
  }
}

async function makeRepo(): Promise<string> {
  const dir = await canonicalMkdtemp('dc-wt-src-');
  runOrFail('git', ['init', '-q', '-b', 'main'], dir);
  runOrFail('git', ['config', 'user.email', 't@t'], dir);
  runOrFail('git', ['config', 'user.name', 't'], dir);
  await fs.writeFile(join(dir, 'a.txt'), 'A');
  runOrFail('git', ['add', '.'], dir);
  runOrFail('git', ['commit', '-q', '-m', 'init'], dir);
  return dir;
}

describe('createWorktree / removeWorktree', () => {
  let src: string;
  let parent: string;

  beforeEach(async () => {
    src = await makeRepo();
    parent = await canonicalMkdtemp('dc-wt-parent-');
  });
  afterEach(async () => {
    await rm(src, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  });

  it('creates a worktree and removes it cleanly', async () => {
    const h = await createWorktree({ source: src, parentDir: parent });
    expect(h.path).toContain(parent);
    expect(h.branch).toMatch(/^dc\//);
    // File is present in worktree
    expect(await fs.readFile(join(h.path, 'a.txt'), 'utf8')).toBe('A');
    await removeWorktree(h);
    await expect(fs.access(h.path)).rejects.toThrow();
  });

  it('honors baseRef from config', async () => {
    // Make a second commit, then branch from the FIRST.
    runOrFail('git', ['tag', 'v0'], src);
    await fs.writeFile(join(src, 'b.txt'), 'B');
    runOrFail('git', ['add', '.'], src);
    runOrFail('git', ['commit', '-q', '-m', 'second'], src);
    const h = await createWorktree({
      source: src,
      parentDir: parent,
      config: { baseRef: 'v0' },
    });
    try {
      // b.txt should NOT exist at the tag-pinned worktree
      await expect(fs.access(join(h.path, 'b.txt'))).rejects.toThrow();
    } finally {
      await removeWorktree(h);
    }
  });

  it('creates symlinks for symlinkDirectories', async () => {
    await fs.mkdir(join(src, 'node_modules'));
    await fs.writeFile(join(src, 'node_modules', 'pkg.txt'), 'real');
    const h = await createWorktree({
      source: src,
      parentDir: parent,
      config: { symlinkDirectories: ['node_modules'] },
    });
    try {
      const stat = await fs.lstat(join(h.path, 'node_modules'));
      expect(stat.isSymbolicLink()).toBe(true);
    } finally {
      await removeWorktree(h);
    }
  });

  it('errors when source is not a git repo', async () => {
    const notARepo = await canonicalMkdtemp('dc-not-repo-');
    try {
      await expect(
        createWorktree({ source: notARepo, parentDir: parent }),
      ).rejects.toThrow(/not a git repository/);
    } finally {
      await rm(notARepo, { recursive: true, force: true });
    }
  });

  it('removeWorktree is idempotent (path already gone)', async () => {
    await removeWorktree({ path: join(parent, 'nope'), branch: 'x', source: src });
    // should not throw
  });
});
