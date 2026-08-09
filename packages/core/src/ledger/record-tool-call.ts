// Turning a completed tool call into a ledger record.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.B
//
// Split out of the agent loop so the mapping — which tools are recordable,
// which paths they touched, what the rollback handle is — can be tested without
// running a turn.

import { normalizeContractPath } from '../config/file-contract.js';
import type { LedgerKind, NewLedgerRecord, RollbackHint } from './index.js';

/**
 * Tools whose completion is worth recording, and where their path lives.
 *
 * Reads are absent on purpose. A ledger answering "what changed and how do I
 * undo it" has nothing to say about a read, and mixing them in would bury the
 * mutations under routine traffic — the same reasoning that splits `changes`
 * from `governance`.
 */
const RECORDABLE: Record<string, { field?: string; kind: LedgerKind }> = {
  Write: { field: 'file_path', kind: 'changes' },
  Edit: { field: 'file_path', kind: 'changes' },
  NotebookEdit: { field: 'notebook_path', kind: 'changes' },
  // Bash has no declarable path. It is still recorded, because "the agent ran
  // this command" is exactly what someone auditing a run needs to see; the
  // pre-Bash git checkpoint is what makes it reversible.
  Bash: { kind: 'changes' },
};

/**
 * The path a read tool opened, or undefined for anything else.
 *
 * Only `Read` and `NotebookEdit`-adjacent single-file reads count. `Grep` and
 * `Glob` take a search *root* and return many paths; calling the root an input
 * would claim a derivation the turn did not make, and enumerating every hit
 * would drown the real inputs in whatever the search happened to sweep up.
 * Provenance is more useful narrow and true than wide and approximate.
 */
export function readPathFor(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool !== 'Read') return undefined;
  const raw = input.file_path;
  return typeof raw === 'string' && raw ? raw : undefined;
}

export function isRecordableTool(tool: string): boolean {
  return tool in RECORDABLE;
}

export function ledgerKindForTool(tool: string): LedgerKind | undefined {
  return RECORDABLE[tool]?.kind;
}

export interface ToolCallRecordInput {
  tool: string;
  input: Record<string, unknown>;
  cwd: string;
  /** The user request driving this turn, used as `intent`. */
  intent?: string;
  threadId?: string;
  turnId?: string;
  actor?: string;
  /** Snapshot/checkpoint sequence captured before the call, if any. */
  snapshotSeq?: number;
  /**
   * Absolute paths this turn read before this call. Normalized and deduped
   * here; the caller only has to observe.
   */
  readPaths?: string[];
}

/** Build the record for a completed tool call, or null if the tool isn't recordable. */
export function buildToolCallRecord(input: ToolCallRecordInput): NewLedgerRecord | null {
  const spec = RECORDABLE[input.tool];
  if (!spec) return null;

  const paths: string[] = [];
  if (spec.field) {
    const raw = input.input[spec.field];
    if (typeof raw === 'string' && raw) {
      // Workspace-relative so a ledger stays readable after the repo moves.
      paths.push(normalizeContractPath(input.cwd, raw) ?? raw);
    }
  }

  const written = new Set(paths);
  const derivedFrom = [
    ...new Set(
      (input.readPaths ?? [])
        .map((raw) => normalizeContractPath(input.cwd, raw) ?? raw)
        // A file the call is itself writing is not an input it was derived
        // from — Edit reads its target by construction, and listing that would
        // make every edit look self-derived.
        .filter((path) => !written.has(path)),
    ),
  ].sort();

  return {
    actor: input.actor ?? 'agent',
    tool: input.tool,
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.intent ? { intent: input.intent } : {}),
    paths,
    ...(derivedFrom.length > 0 ? { derivedFrom } : {}),
    summary: summarize(input.tool, input.input, paths),
    ...(rollbackFor(input) ? { rollbackHint: rollbackFor(input)! } : {}),
  };
}

function summarize(tool: string, args: Record<string, unknown>, paths: string[]): string {
  if (tool === 'Bash') {
    const command = typeof args.command === 'string' ? args.command : '(no command)';
    return `ran: ${command}`;
  }
  const target = paths[0] ?? '(unknown path)';
  if (tool === 'Write') return `wrote ${target}`;
  if (tool === 'Edit') {
    const all = args.replace_all === true ? ' (all occurrences)' : '';
    return `edited ${target}${all}`;
  }
  if (tool === 'NotebookEdit') {
    const mode = typeof args.edit_mode === 'string' ? args.edit_mode : 'replace';
    return `${mode} notebook cell in ${target}`;
  }
  return `${tool} on ${target}`;
}

/**
 * How to undo this call.
 *
 * Snapshots and git checkpoints are already taken around mutating calls; the
 * ledger only makes them addressable and pairs them with intent. Without a
 * sequence number there is nothing honest to point at, so the record carries no
 * hint rather than a guess.
 */
function rollbackFor(input: ToolCallRecordInput): RollbackHint | undefined {
  if (input.snapshotSeq === undefined) return undefined;
  return {
    kind: input.tool === 'Bash' ? 'git' : 'snapshot',
    ref: String(input.snapshotSeq),
    command: `deepcode ledger rollback <id>`,
  };
}
