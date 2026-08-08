// Planning a ledger rollback: find the checkpoint, work out what undoing it
// would cost, and hand the result to the No Silent Apply ceremony.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.B / §2.F

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { listSnapshots, restoreSnapshot, type Snapshot } from '../sessions/snapshots.js';
import type { ApplyPlan } from '../runtime/apply-ceremony.js';
import type { LedgerRecord } from './index.js';

export interface RollbackContext {
  record: LedgerRecord;
  sessionsRoot: string;
  cwd: string;
}

export type RollbackPlanResult =
  | { status: 'ready'; plan: ApplyPlan<string[]>; snapshot: Snapshot }
  | { status: 'unavailable'; reason: string };

/**
 * Build a rollback plan for a ledger record, or explain why there isn't one.
 *
 * Returns `unavailable` rather than throwing for the ordinary cases — no
 * rollback hint, no session, a pruned snapshot. Those are expected states of an
 * audit log, not errors, and the user needs the reason more than a stack trace.
 */
export async function planRollback(ctx: RollbackContext): Promise<RollbackPlanResult> {
  const { record } = ctx;
  if (!record.rollbackHint || record.rollbackHint.ref === undefined) {
    return { status: 'unavailable', reason: 'this record has no rollback point' };
  }
  if (!record.threadId) {
    return { status: 'unavailable', reason: 'this record is not tied to a session' };
  }

  const seq = Number(record.rollbackHint.ref);
  if (!Number.isFinite(seq)) {
    return {
      status: 'unavailable',
      reason: `unrecognised rollback ref "${record.rollbackHint.ref}"`,
    };
  }

  let snapshots: Snapshot[];
  try {
    snapshots = await listSnapshots({ sessionsRoot: ctx.sessionsRoot, sessionId: record.threadId });
  } catch (err) {
    return { status: 'unavailable', reason: `could not read snapshots: ${(err as Error).message}` };
  }

  const target = snapshots.find((s) => s.seq === seq);
  if (!target) {
    // Snapshots and ledger records age out on different schedules, so this is a
    // normal outcome rather than corruption.
    return { status: 'unavailable', reason: `snapshot ${seq} is no longer available` };
  }

  const warnings = await detectConflicts(target, snapshots);
  const preview =
    target.kind === 'git'
      ? [`restore tracked files changed since checkpoint ${target.gitRef ?? '(unknown)'}`]
      : [`${target.existed === false ? 'delete' : 'restore'} ${target.filePath}`];

  return {
    status: 'ready',
    snapshot: target,
    plan: {
      title: `Roll back ${record.id}: ${record.summary}`,
      explanation: {
        source: `ledger record ${record.id} (${record.timestamp})`,
        method:
          target.kind === 'git'
            ? 'git diff between the pre-command checkpoint and the working tree'
            : 'the file snapshot captured immediately before the change',
        application:
          target.kind === 'git'
            ? 'git checkout of the changed files back to the checkpoint'
            : target.existed === false
              ? 'delete the file, which did not exist before the change'
              : 'overwrite the file with its pre-change contents',
        rollback:
          'this rollback is itself recorded in the governance ledger; use git to undo it if needed',
      },
      preview,
      warnings,
      apply: () => restoreSnapshot(target),
    },
  };
}

/**
 * Conditions that make a rollback lossy.
 *
 * Undoing an old change is not the same operation as undoing the last one: any
 * later edit to the same file gets discarded along with it. Applying that
 * silently is precisely the failure the ceremony exists to prevent, so the
 * plan carries the cost rather than the caller having to think of it.
 */
async function detectConflicts(target: Snapshot, all: Snapshot[]): Promise<string[]> {
  const warnings: string[] = [];
  if (target.kind === 'git') {
    warnings.push(
      'This restores every tracked file the command touched. Changes made to those files afterwards will be lost.',
    );
    return warnings;
  }

  const laterForSameFile = all.filter((s) => s.filePath === target.filePath && s.seq > target.seq);
  // A `post-` capture of the same call is the change being undone, not a
  // separate later edit, so it is not a conflict.
  const laterEdits = laterForSameFile.filter((s) => !s.reason.startsWith('post-'));
  if (laterEdits.length > 0) {
    warnings.push(
      `${laterEdits.length} later change(s) to ${target.filePath} in this session will be discarded too.`,
    );
  }

  const newest = laterForSameFile.at(-1);
  if (newest) {
    const current = await hashFile(target.filePath);
    if (current !== null && current !== newest.hash) {
      warnings.push(
        `${target.filePath} has been modified outside DeepCode since the last snapshot; those edits will be lost.`,
      );
    }
  }

  return warnings;
}

async function hashFile(path: string): Promise<string | null> {
  try {
    const content = await fs.readFile(path);
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}
