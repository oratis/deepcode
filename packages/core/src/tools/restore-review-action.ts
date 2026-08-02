import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { captureSnapshot, listSnapshots, type Snapshot } from '../sessions/snapshots.js';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface RestoreCandidate {
  filePath: string;
  before: Snapshot;
  beforeBytes: Buffer;
  currentBytes: Buffer;
}

const MAX_RESTORE_FILES = 100;
const MAX_RESTORE_FILE_BYTES = 16 * 1024 * 1024;
const MAX_RESTORE_TOTAL_BYTES = 64 * 1024 * 1024;

/** Compare-and-swap restore for the exact Edit/Write footprint of one canonical turn. */
export const RestoreReviewActionTool: ToolHandler = {
  name: 'RestoreReviewAction',
  definition: {
    name: 'RestoreReviewAction',
    description:
      'Conflict-safely revert the exact Edit/Write changes from one prior review action turn. ' +
      'Use only when asked to revert that action. Refuses if any affected file changed afterward.',
    inputSchema: {
      type: 'object',
      properties: {
        action_turn_id: {
          type: 'string',
          description: 'Canonical turn id recorded by the review_action item.',
        },
      },
      required: ['action_turn_id'],
    },
  },
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const actionTurnId = input.action_turn_id;
    if (typeof actionTurnId !== 'string' || !/^[a-zA-Z0-9._-]{1,200}$/.test(actionTurnId)) {
      return failure('action_turn_id is invalid');
    }
    if (!ctx.sessionDir) return failure('session snapshots are unavailable');

    try {
      const sessionDir = resolve(ctx.sessionDir);
      const sessionsRoot = dirname(sessionDir);
      const sessionId = basename(sessionDir);
      const snapshots = await listSnapshots({ sessionsRoot, sessionId });
      const scoped = snapshots.filter((snapshot) => snapshot.turnId === actionTurnId);
      if (scoped.some((snapshot) => snapshot.kind === 'git')) {
        return failure('the action used Bash; an exact file-level revert is unavailable');
      }
      const candidates = await collectCandidates(scoped, ctx.cwd, sessionDir);
      if (candidates.length === 0) {
        return failure('no complete Edit/Write snapshot pairs were found for this action');
      }

      let sequence = snapshots.reduce((maximum, snapshot) => Math.max(maximum, snapshot.seq), 0);
      for (const candidate of candidates) {
        await captureSnapshot({
          sessionsRoot,
          sessionId,
          cwd: ctx.cwd,
          filePath: candidate.filePath,
          reason: 'pre-RestoreReviewAction',
          seq: ++sequence,
          turnId: ctx.turnId,
        });
      }

      const restored: RestoreCandidate[] = [];
      try {
        for (const candidate of candidates) {
          await restoreBeforeImage(candidate);
          restored.push(candidate);
        }
      } catch (error) {
        await Promise.allSettled(
          restored.map((candidate) => fs.writeFile(candidate.filePath, candidate.currentBytes)),
        );
        throw error;
      }

      const snapshotWarnings: string[] = [];
      for (const candidate of candidates) {
        try {
          await captureSnapshot({
            sessionsRoot,
            sessionId,
            cwd: ctx.cwd,
            filePath: candidate.filePath,
            reason: 'post-RestoreReviewAction',
            seq: ++sequence,
            turnId: ctx.turnId,
          });
        } catch (error) {
          snapshotWarnings.push((error as Error).message);
        }
      }
      const files = candidates.map((candidate) => relative(resolve(ctx.cwd), candidate.filePath));
      return {
        content: `Restored review action ${actionTurnId}: ${files.join(', ')}${
          snapshotWarnings.length ? ' (post-restore snapshot warning)' : ''
        }`,
        data: { actionTurnId, files, snapshotWarnings },
      };
    } catch (error) {
      return failure((error as Error).message);
    }
  },
};

async function collectCandidates(
  snapshots: Snapshot[],
  cwd: string,
  sessionDir: string,
): Promise<RestoreCandidate[]> {
  const byFile = new Map<string, Snapshot[]>();
  for (const snapshot of snapshots) {
    if (snapshot.kind === 'git') continue;
    const rows = byFile.get(snapshot.filePath) ?? [];
    rows.push(snapshot);
    byFile.set(snapshot.filePath, rows);
  }
  const candidates: RestoreCandidate[] = [];
  if (byFile.size > MAX_RESTORE_FILES) {
    throw new Error(`review action affects more than ${MAX_RESTORE_FILES} files`);
  }
  let totalBytes = 0;
  for (const [filePath, rows] of byFile) {
    rows.sort((left, right) => left.seq - right.seq);
    const before = rows.find((snapshot) => snapshot.reason.startsWith('pre-'));
    const after = [...rows].reverse().find((snapshot) => snapshot.reason.startsWith('post-'));
    if (!before || !after || before.seq >= after.seq || before.existed === undefined) continue;
    await assertWorkspaceFile(filePath, cwd);
    const beforeBytes = await verifiedBlob(before, sessionDir);
    const afterBytes = await verifiedBlob(after, sessionDir);
    const currentBytes = await fs.readFile(filePath);
    if (!currentBytes.equals(afterBytes)) {
      throw new Error(
        `conflict: ${relative(resolve(cwd), filePath)} changed after the review action`,
      );
    }
    totalBytes += beforeBytes.byteLength + currentBytes.byteLength;
    if (totalBytes > MAX_RESTORE_TOTAL_BYTES) {
      throw new Error('review action restore exceeds the total byte limit');
    }
    candidates.push({ filePath, before, beforeBytes, currentBytes });
  }
  return candidates;
}

async function assertWorkspaceFile(filePath: string, cwd: string): Promise<void> {
  const lexicalWorkspace = resolve(cwd);
  const absolute = resolve(filePath);
  const workspaceRelative = relative(lexicalWorkspace, absolute);
  if (!workspaceRelative || workspaceRelative.startsWith('..') || isAbsolute(workspaceRelative)) {
    throw new Error(`snapshot path is outside the workspace: ${filePath}`);
  }
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`refusing to restore symlink: ${workspaceRelative}`);
  if (!stat.isFile()) throw new Error(`refusing to restore non-file: ${workspaceRelative}`);
  if (stat.nlink > 1) throw new Error(`refusing to restore hard-linked file: ${workspaceRelative}`);
  if (stat.size > MAX_RESTORE_FILE_BYTES) {
    throw new Error(`file exceeds the review restore byte limit: ${workspaceRelative}`);
  }
  const workspace = await fs.realpath(lexicalWorkspace);
  const real = await fs.realpath(absolute);
  const realRelative = relative(workspace, real);
  if (!realRelative || realRelative.startsWith('..') || isAbsolute(realRelative)) {
    throw new Error(`snapshot target escapes the workspace: ${workspaceRelative}`);
  }
}

async function verifiedBlob(snapshot: Snapshot, sessionDir: string): Promise<Buffer> {
  const snapshotsDir = await fs.realpath(resolve(sessionDir, 'snapshots'));
  const blob = await fs.realpath(snapshot.blobPath);
  const blobRelative = relative(snapshotsDir, blob);
  if (!blobRelative || blobRelative.startsWith('..') || isAbsolute(blobRelative)) {
    throw new Error('snapshot blob is outside the session');
  }
  const stat = await fs.lstat(blob);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('snapshot blob is not a regular file');
  if (stat.size !== snapshot.size)
    throw new Error('snapshot blob size does not match its manifest');
  if (stat.size > MAX_RESTORE_FILE_BYTES) throw new Error('snapshot blob exceeds the byte limit');
  const bytes = await fs.readFile(blob);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  if (hash !== snapshot.hash)
    throw new Error(`snapshot integrity check failed: ${snapshot.filePath}`);
  return bytes;
}

async function restoreBeforeImage(candidate: RestoreCandidate): Promise<void> {
  if (candidate.before.existed === false) {
    await fs.unlink(candidate.filePath);
    return;
  }
  await fs.writeFile(candidate.filePath, candidate.beforeBytes);
}

function failure(message: string): ToolResult {
  return { content: `Error: ${message}`, isError: true };
}
