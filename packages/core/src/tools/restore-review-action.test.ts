import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { captureSnapshot, listSnapshots } from '../sessions/snapshots.js';
import { RestoreReviewActionTool } from './restore-review-action.js';

describe('RestoreReviewActionTool', () => {
  let root: string;
  let cwd: string;
  let sessionsRoot: string;
  const sessionId = 'thread-1';
  const actionTurnId = 'turn-apply';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deepcode-review-revert-'));
    cwd = join(root, 'workspace');
    sessionsRoot = join(root, 'sessions');
    await fs.mkdir(cwd);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('restores an unchanged post-image and snapshots the revert turn', async () => {
    const filePath = join(cwd, 'a.txt');
    await fs.writeFile(filePath, 'before');
    await snapshot(filePath, 'pre-Edit', 1);
    await fs.writeFile(filePath, 'after');
    await snapshot(filePath, 'post-Edit', 2);

    const result = await RestoreReviewActionTool.execute(
      { action_turn_id: actionTurnId },
      { cwd, sessionDir: join(sessionsRoot, sessionId), turnId: 'turn-revert' },
    );

    expect(result.isError).not.toBe(true);
    expect(await fs.readFile(filePath, 'utf8')).toBe('before');
    const snapshots = await listSnapshots({ sessionsRoot, sessionId });
    expect(snapshots.slice(-2)).toEqual([
      expect.objectContaining({ reason: 'pre-RestoreReviewAction', turnId: 'turn-revert' }),
      expect.objectContaining({ reason: 'post-RestoreReviewAction', turnId: 'turn-revert' }),
    ]);
  });

  it('refuses atomically when the file changed after the action', async () => {
    const filePath = join(cwd, 'a.txt');
    await fs.writeFile(filePath, 'before');
    await snapshot(filePath, 'pre-Edit', 1);
    await fs.writeFile(filePath, 'after');
    await snapshot(filePath, 'post-Edit', 2);
    await fs.writeFile(filePath, 'later user edit');

    const result = await RestoreReviewActionTool.execute(
      { action_turn_id: actionTurnId },
      { cwd, sessionDir: join(sessionsRoot, sessionId), turnId: 'turn-revert' },
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
    expect(result.content).toContain('conflict');
    expect(await fs.readFile(filePath, 'utf8')).toBe('later user edit');
  });

  it('deletes a file that did not exist before the action', async () => {
    const filePath = join(cwd, 'new.txt');
    await snapshot(filePath, 'pre-Write', 1);
    await fs.writeFile(filePath, 'created');
    await snapshot(filePath, 'post-Write', 2);

    const result = await RestoreReviewActionTool.execute(
      { action_turn_id: actionTurnId },
      { cwd, sessionDir: join(sessionsRoot, sessionId), turnId: 'turn-revert' },
    );

    expect(result.isError).not.toBe(true);
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a corrupted snapshot blob before writing', async () => {
    const filePath = join(cwd, 'a.txt');
    await fs.writeFile(filePath, 'before');
    await snapshot(filePath, 'pre-Edit', 1);
    await fs.writeFile(filePath, 'after');
    const post = await snapshot(filePath, 'post-Edit', 2);
    await fs.writeFile(post!.blobPath, 'evil!');

    const result = await RestoreReviewActionTool.execute(
      { action_turn_id: actionTurnId },
      { cwd, sessionDir: join(sessionsRoot, sessionId), turnId: 'turn-revert' },
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
    expect(result.content).toContain('integrity check failed');
    expect(await fs.readFile(filePath, 'utf8')).toBe('after');
  });

  it('refuses to mutate a hard-linked workspace file', async () => {
    const outside = join(root, 'outside.txt');
    const filePath = join(cwd, 'linked.txt');
    await fs.writeFile(outside, 'before');
    await fs.link(outside, filePath);
    await snapshot(filePath, 'pre-Edit', 1);
    await fs.writeFile(filePath, 'after');
    await snapshot(filePath, 'post-Edit', 2);

    const result = await RestoreReviewActionTool.execute(
      { action_turn_id: actionTurnId },
      { cwd, sessionDir: join(sessionsRoot, sessionId), turnId: 'turn-revert' },
    );

    expect(result).toEqual(expect.objectContaining({ isError: true }));
    expect(result.content).toContain('hard-linked');
    expect(await fs.readFile(outside, 'utf8')).toBe('after');
  });

  async function snapshot(filePath: string, reason: string, seq: number) {
    return captureSnapshot({
      sessionsRoot,
      sessionId,
      cwd,
      filePath,
      reason,
      seq,
      turnId: actionTurnId,
    });
  }
});
