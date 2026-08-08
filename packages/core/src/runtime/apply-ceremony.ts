// No Silent Apply — the four steps every high-impact application goes through.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.F
//
// Selfware §6.3 states it as: explain the update logic, show a summary, ask the
// user to accept/reject/defer, and apply only on accept — with a rollback point
// created first (§7). This module is that sequence, host-agnostic, so
// `ledger rollback`, plugin installs, and contract changes all get the same
// ceremony rather than four hand-rolled confirmation prompts that drift apart.
//
// The load-bearing decision: `confirm` is REQUIRED. There is no "assume yes"
// path and no default. A caller that cannot ask a human cannot apply — which is
// what makes "no silent apply" a property of the type signature rather than a
// convention people remember.

export type ApplyDecision = 'accept' | 'reject' | 'defer';

/** Why an application is safe to accept — Selfware §6.3 step 1. */
export interface ApplyExplanation {
  /** Where the change comes from. */
  source: string;
  /** How the current and proposed states were compared. */
  method: string;
  /** What will physically happen on accept. */
  application: string;
  /** How to get back, in the user's own hands. */
  rollback: string;
}

/** What the user is shown before deciding. */
export interface ApplyPresentation {
  title: string;
  explanation: ApplyExplanation;
  /** Diff lines, a file list, or whatever makes the change concrete. */
  preview: string[];
  /**
   * Conditions that make this riskier than usual — later edits that would be
   * discarded, a file changed outside DeepCode. Never empty-by-omission: a
   * caller that detects nothing passes `[]` deliberately.
   */
  warnings: string[];
}

export interface ApplyPlan<T> extends ApplyPresentation {
  /** Create a restore point. Runs after accept, before `apply`. */
  createRollbackPoint?: () => Promise<string | undefined>;
  apply: () => Promise<T>;
}

export type ApplyConfirm = (presentation: ApplyPresentation) => Promise<ApplyDecision>;

export interface ApplyOutcome<T> {
  status: 'applied' | 'rejected' | 'deferred' | 'failed';
  result?: T;
  /** Identifier of the restore point taken before applying, when one was. */
  rollbackPoint?: string;
  error?: Error;
}

/**
 * Run the ceremony. Applies only on an explicit `accept`.
 *
 * Rejection is not a failure — Selfware §6.3 requires the current version stay
 * working after a reject, so `rejected` and `deferred` are ordinary outcomes
 * and neither throws.
 */
export async function applyWithCeremony<T>(
  plan: ApplyPlan<T>,
  confirm: ApplyConfirm,
): Promise<ApplyOutcome<T>> {
  const decision = await confirm({
    title: plan.title,
    explanation: plan.explanation,
    preview: plan.preview,
    warnings: plan.warnings,
  });

  if (decision === 'reject') return { status: 'rejected' };
  if (decision === 'defer') return { status: 'deferred' };

  let rollbackPoint: string | undefined;
  if (plan.createRollbackPoint) {
    try {
      rollbackPoint = await plan.createRollbackPoint();
    } catch (err) {
      // Refuse rather than proceed unprotected. The user accepted an operation
      // described as reversible; applying it irreversibly is not that operation.
      return {
        status: 'failed',
        error: new Error(
          `could not create a rollback point, so nothing was applied: ${(err as Error).message}`,
        ),
      };
    }
  }

  try {
    return {
      status: 'applied',
      result: await plan.apply(),
      ...(rollbackPoint ? { rollbackPoint } : {}),
    };
  } catch (err) {
    return { status: 'failed', error: err as Error, ...(rollbackPoint ? { rollbackPoint } : {}) };
  }
}

/** Render a presentation as plain text, so every host words it the same way. */
export function renderApplyPresentation(p: ApplyPresentation): string {
  const lines = [p.title, ''];
  lines.push(`  source     : ${p.explanation.source}`);
  lines.push(`  compared   : ${p.explanation.method}`);
  lines.push(`  applies    : ${p.explanation.application}`);
  lines.push(`  rollback   : ${p.explanation.rollback}`);
  if (p.preview.length > 0) {
    lines.push('', 'Changes:');
    for (const line of p.preview) lines.push(`  ${line}`);
  }
  if (p.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of p.warnings) lines.push(`  ! ${warning}`);
  }
  return lines.join('\n') + '\n';
}
