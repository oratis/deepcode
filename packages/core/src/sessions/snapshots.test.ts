import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureGitCheckpoint,
  captureSnapshot,
  listSnapshots,
  restoreSnapshot,
} from './snapshots.js';

const exec = promisify(execFile);
async function gitInit(dir: string): Promise<void> {
  await exec('git', ['init', '-q'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.dev'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await exec('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
}
async function gitCommitAll(dir: string, msg: string): Promise<void> {
  await exec('git', ['add', '-A'], { cwd: dir });
  await exec('git', ['commit', '-q', '-m', msg], { cwd: dir });
}

describe('snapshots', () => {
  let root: string;
  let cwd: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dc-snaps-root-'));
    cwd = await mkdtemp(join(tmpdir(), 'dc-snaps-cwd-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('captures a snapshot of an existing file', async () => {
    const path = join(cwd, 'foo.txt');
    await fs.writeFile(path, 'original content');
    const snap = await captureSnapshot({
      sessionsRoot: root,
      sessionId: 'sid',
      cwd,
      filePath: 'foo.txt',
      reason: 'pre-Edit',
      seq: 1,
    });
    expect(snap).toBeTruthy();
    expect(snap?.size).toBe(16);
    expect(snap?.reason).toBe('pre-Edit');
    expect(snap?.filePath).toBe(path);
    expect(await fs.readFile(snap!.blobPath, 'utf8')).toBe('original content');
  });

  it('captures empty snapshot for non-existent file', async () => {
    const snap = await captureSnapshot({
      sessionsRoot: root,
      sessionId: 'sid',
      cwd,
      filePath: 'missing.txt',
      reason: 'pre-Write',
      seq: 1,
    });
    expect(snap?.size).toBe(0);
  });

  it('listSnapshots reads back manifest', async () => {
    const path = join(cwd, 'x.txt');
    await fs.writeFile(path, 'v1');
    await captureSnapshot({
      sessionsRoot: root,
      sessionId: 'sid',
      cwd,
      filePath: 'x.txt',
      reason: 'pre-Edit',
      seq: 1,
    });
    await fs.writeFile(path, 'v2');
    await captureSnapshot({
      sessionsRoot: root,
      sessionId: 'sid',
      cwd,
      filePath: 'x.txt',
      reason: 'post-Edit',
      seq: 2,
    });
    const snaps = await listSnapshots({ sessionsRoot: root, sessionId: 'sid' });
    expect(snaps).toHaveLength(2);
    expect(snaps[0]?.reason).toBe('pre-Edit');
    expect(snaps[1]?.reason).toBe('post-Edit');
  });

  it('restoreSnapshot writes blob back to original path', async () => {
    const path = join(cwd, 'y.txt');
    await fs.writeFile(path, 'original');
    const snap = await captureSnapshot({
      sessionsRoot: root,
      sessionId: 'sid',
      cwd,
      filePath: 'y.txt',
      reason: 'pre',
      seq: 1,
    });
    await fs.writeFile(path, 'modified');
    expect(await fs.readFile(path, 'utf8')).toBe('modified');
    await restoreSnapshot(snap!);
    expect(await fs.readFile(path, 'utf8')).toBe('original');
  });

  it('listSnapshots returns [] for unknown session', async () => {
    expect(await listSnapshots({ sessionsRoot: root, sessionId: 'nope' })).toEqual([]);
  });
});

describe('git checkpoints (for Bash mutations)', () => {
  let root: string;
  let repo: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dc-gitsnap-root-'));
    repo = await mkdtemp(join(tmpdir(), 'dc-gitsnap-repo-'));
    await gitInit(repo);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it('returns null outside a git work tree', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'dc-plain-'));
    try {
      const snap = await captureGitCheckpoint({
        sessionsRoot: root,
        sessionId: 'sid',
        cwd: plain,
        reason: 'pre-Bash',
        seq: 1,
      });
      expect(snap).toBeNull();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it('checkpoints a clean tree and reverts a Bash-style modification', async () => {
    const f = join(repo, 'app.txt');
    await fs.writeFile(f, 'v1\n');
    await gitCommitAll(repo, 'init');

    const snap = await captureGitCheckpoint({
      sessionsRoot: root,
      sessionId: 'sid',
      cwd: repo,
      reason: 'pre-Bash',
      seq: 1,
    });
    expect(snap?.kind).toBe('git');
    expect(snap?.gitRef).toBeTruthy();

    // Simulate a Bash command rewriting the file.
    await fs.writeFile(f, 'v2-mutated\n');
    const restored = await restoreSnapshot(snap!);
    expect(restored).toEqual(['app.txt']);
    expect(await fs.readFile(f, 'utf8')).toBe('v1\n');
  });

  it('captures uncommitted pre-command state (git stash create), not just HEAD', async () => {
    const f = join(repo, 'app.txt');
    await fs.writeFile(f, 'committed\n');
    await gitCommitAll(repo, 'init');
    // A prior (e.g. Edit) change leaves the tree dirty before the Bash command.
    await fs.writeFile(f, 'dirty-before-bash\n');

    const snap = await captureGitCheckpoint({
      sessionsRoot: root,
      sessionId: 'sid',
      cwd: repo,
      reason: 'pre-Bash',
      seq: 1,
    });

    // Bash then rewrites it again.
    await fs.writeFile(f, 'after-bash\n');
    await restoreSnapshot(snap!);
    // Restored to the dirty pre-command state, NOT the last commit.
    expect(await fs.readFile(f, 'utf8')).toBe('dirty-before-bash\n');
  });

  it('manifest round-trips a git snapshot via listSnapshots', async () => {
    await fs.writeFile(join(repo, 'a.txt'), 'x\n');
    await gitCommitAll(repo, 'init');
    await captureGitCheckpoint({
      sessionsRoot: root,
      sessionId: 'sid',
      cwd: repo,
      reason: 'pre-Bash',
      seq: 7,
    });
    const snaps = await listSnapshots({ sessionsRoot: root, sessionId: 'sid' });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.kind).toBe('git');
    expect(snaps[0]?.reason).toBe('pre-Bash');
    expect(snaps[0]?.seq).toBe(7);
  });
});
