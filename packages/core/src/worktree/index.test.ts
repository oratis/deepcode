import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorktree, removeWorktree } from './index.js';

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dc-wt-src-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  await fs.writeFile(join(dir, 'a.txt'), 'A');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('createWorktree / removeWorktree', () => {
  let src: string;
  let parent: string;

  beforeEach(async () => {
    src = await makeRepo();
    parent = await mkdtemp(join(tmpdir(), 'dc-wt-parent-'));
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
    spawnSync('git', ['-C', src, 'tag', 'v0']);
    await fs.writeFile(join(src, 'b.txt'), 'B');
    spawnSync('git', ['-C', src, 'add', '.'], {});
    spawnSync('git', ['-C', src, 'commit', '-q', '-m', 'second'], {});
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
    const notARepo = await mkdtemp(join(tmpdir(), 'dc-not-repo-'));
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
