import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureSnapshot, listSnapshots, restoreSnapshot } from './snapshots.js';

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
