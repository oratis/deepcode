// File snapshots — captured before each Edit/Write so the right-side file panel's
// History tab AND the /rewind command share the same data source.
// Spec: docs/DEVELOPMENT_PLAN.md §3.11 + §3.15.9

import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { sessionFiles } from './storage.js';

export interface Snapshot {
  filePath: string;
  capturedAt: string;
  reason: string; // e.g. "pre-Edit" / "post-Edit" / "session-start"
  hash: string;
  size: number;
  /** Sequential within the session. */
  seq: number;
  /** Absolute path on disk where the snapshot blob is stored. */
  blobPath: string;
}

export function snapshotsDirFor(sessionsRoot: string, sessionId: string): string {
  return sessionFiles(sessionsRoot, sessionId).snapshotsDir;
}

/** Capture the current state of a file as a snapshot. */
export async function captureSnapshot(args: {
  sessionsRoot: string;
  sessionId: string;
  cwd: string;
  filePath: string;
  reason: string;
  seq: number;
}): Promise<Snapshot | null> {
  const absPath = isAbsolute(args.filePath) ? args.filePath : resolve(args.cwd, args.filePath);
  let content: Buffer;
  try {
    content = await fs.readFile(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // file doesn't exist yet — record an empty snapshot so post-Write diff still works
      content = Buffer.from('');
    } else {
      throw err;
    }
  }
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const dir = snapshotsDirFor(args.sessionsRoot, args.sessionId);
  await fs.mkdir(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
  const blobName = `${String(args.seq).padStart(5, '0')}-${ts}-${hash}.blob`;
  const blobPath = join(dir, blobName);
  await fs.writeFile(blobPath, content);

  const snap: Snapshot = {
    filePath: absPath,
    capturedAt: new Date().toISOString(),
    reason: args.reason,
    hash,
    size: content.byteLength,
    seq: args.seq,
    blobPath,
  };
  // also append to a per-session manifest for fast listing
  const manifestPath = join(dir, 'manifest.jsonl');
  await fs.appendFile(manifestPath, JSON.stringify(snap) + '\n', 'utf8');
  return snap;
}

export async function listSnapshots(args: {
  sessionsRoot: string;
  sessionId: string;
}): Promise<Snapshot[]> {
  const manifestPath = join(snapshotsDirFor(args.sessionsRoot, args.sessionId), 'manifest.jsonl');
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Snapshot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Restore a snapshot's content back to its file. */
export async function restoreSnapshot(snap: Snapshot): Promise<void> {
  const content = await fs.readFile(snap.blobPath);
  await fs.mkdir(dirname(snap.filePath), { recursive: true });
  await fs.writeFile(snap.filePath, content);
}
