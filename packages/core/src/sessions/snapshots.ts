// File snapshots — captured before each Edit/Write so the right-side file panel's
// History tab AND the /rewind command share the same data source.
// Spec: docs/DEVELOPMENT_PLAN.md §3.11 + §3.15.9

import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { sessionFiles } from './storage.js';

const execFileAsync = promisify(execFile);

export interface Snapshot {
  filePath: string;
  capturedAt: string;
  reason: string; // e.g. "pre-Edit" / "post-Edit" / "pre-Bash" / "session-start"
  hash: string;
  size: number;
  /** Sequential within the session. */
  seq: number;
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

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
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

/**
 * Capture a git working-tree checkpoint before a Bash command. Unlike per-file
 * snapshots, the set of files a shell command touches isn't known in advance, so
 * we record a commit-ish (`git stash create`, or HEAD if the tree is clean) that
 * captures the current TRACKED state. Restoring re-checks-out the files that
 * changed since. No-op (returns null) outside a git work tree or in a repo with
 * no commits. NOTE: untracked files created by the command aren't captured.
 */
export async function captureGitCheckpoint(args: {
  sessionsRoot: string;
  sessionId: string;
  cwd: string;
  reason: string;
  seq: number;
}): Promise<Snapshot | null> {
  try {
    if ((await git(args.cwd, ['rev-parse', '--is-inside-work-tree'])) !== 'true') return null;
  } catch {
    return null; // git missing or not a repo
  }
  let ref: string;
  try {
    ref =
      (await git(args.cwd, ['stash', 'create'])) || (await git(args.cwd, ['rev-parse', 'HEAD']));
  } catch {
    return null; // e.g. a repo with no commits yet
  }
  if (!ref) return null;

  const snap: Snapshot = {
    filePath: resolve(args.cwd),
    capturedAt: new Date().toISOString(),
    reason: args.reason,
    hash: ref.slice(0, 16),
    size: 0,
    seq: args.seq,
    blobPath: '',
    kind: 'git',
    gitRef: ref,
  };
  const dir = snapshotsDirFor(args.sessionsRoot, args.sessionId);
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(join(dir, 'manifest.jsonl'), JSON.stringify(snap) + '\n', 'utf8');
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

/**
 * Restore a snapshot. For a 'file' snapshot, write its blob back. For a 'git'
 * checkpoint, `git checkout <ref> -- <files changed since>` in the repo —
 * reverting tracked files the command modified back to the checkpoint state.
 * Returns the list of restored paths (the single file for blobs).
 */
export async function restoreSnapshot(snap: Snapshot): Promise<string[]> {
  if (snap.kind === 'git') {
    if (!snap.gitRef) throw new Error('git snapshot is missing its ref');
    const repo = snap.filePath;
    const changed = (await git(repo, ['diff', '--name-only', snap.gitRef, '--']))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (changed.length === 0) return [];
    await git(repo, ['checkout', snap.gitRef, '--', ...changed]);
    return changed;
  }
  const content = await fs.readFile(snap.blobPath);
  await fs.mkdir(dirname(snap.filePath), { recursive: true });
  await fs.writeFile(snap.filePath, content);
  return [snap.filePath];
}
