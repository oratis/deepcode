// Maps a tool call onto the file contract's (path, action) axes and composes
// the result with the tool-rule verdict.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.A

import {
  evaluatePath,
  normalizeContractPath,
  type ContractAction,
  type ContractEvaluation,
  type FileContract,
} from './file-contract.js';
import type { PermissionVerdict } from './permissions.js';

/**
 * Which contract axis each tool exercises, and where it keeps its path.
 *
 * Declared rather than inferred. A tool absent from this table gets no contract
 * verdict at all, which is the honest answer for tools whose effect cannot be
 * pinned to one path.
 *
 * `Bash` is deliberately absent. `cat .env` is a string, and statically parsing
 * shell to decide otherwise would be guesswork presented as enforcement — worse
 * than not trying, because it reads as a guarantee. Bash is bounded by the
 * sandbox alone; `fileContractWarnings` says so out loud when a contract's
 * read/execute denies are running with the sandbox off.
 */
const TOOL_AXIS: Record<string, { action: ContractAction; field: string }> = {
  Read: { action: 'read', field: 'file_path' },
  Grep: { action: 'read', field: 'path' },
  Glob: { action: 'read', field: 'path' },
  Write: { action: 'write', field: 'file_path' },
  Edit: { action: 'write', field: 'file_path' },
  NotebookEdit: { action: 'write', field: 'notebook_path' },
};

export interface ContractDispatchRequest {
  tool: string;
  input: Record<string, unknown>;
  cwd: string;
}

/**
 * The contract's opinion about one tool call, or `no-match` when it has none —
 * because there is no contract, the tool has no path axis, the argument is
 * missing, or the path lies outside the workspace.
 */
export function evaluateContract(
  contract: FileContract | undefined,
  req: ContractDispatchRequest,
): ContractEvaluation {
  if (!contract) return { verdict: 'no-match' };
  const axis = TOOL_AXIS[req.tool];
  if (!axis) return { verdict: 'no-match' };
  const raw = req.input[axis.field];
  if (typeof raw !== 'string' || raw === '') return { verdict: 'no-match' };
  const path = normalizeContractPath(req.cwd, raw);
  if (path === null) return { verdict: 'no-match' };
  return evaluatePath(contract, { path, action: axis.action });
}

/** Tools the contract can speak about — exported so docs and tests share one list. */
export function contractGovernedTools(): string[] {
  return Object.keys(TOOL_AXIS);
}

const SEVERITY: Record<PermissionVerdict, number> = {
  'no-match': 0,
  allow: 1,
  ask: 2,
  deny: 3,
};

/**
 * Combine the tool-rule verdict with the contract verdict, most restrictive
 * winning.
 *
 * `no-match` means "no opinion" and never wins, which is what makes an absent
 * contract a genuine no-op rather than an approximate one: it collapses to the
 * tool verdict exactly.
 *
 * The composition is one-directional by construction — a contract can tighten
 * `allow` to `ask` or `deny`, and can never loosen a `deny` from settings.json.
 * That is why adding a contract cannot reduce existing safety.
 */
export function mostRestrictive(a: PermissionVerdict, b: PermissionVerdict): PermissionVerdict {
  if (a === 'no-match') return b;
  if (b === 'no-match') return a;
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export interface ContractWarningInput {
  status: 'absent' | 'loaded' | 'invalid';
  contract?: FileContract;
  path?: string;
  error?: string;
  /** Resolved sandbox mode for this run. */
  sandboxMode?: string;
}

/**
 * Operator-facing warnings about a contract's real reach.
 *
 * Pure and host-agnostic so the CLI, `doctor`, and the desktop app print the
 * same words. Both cases here exist to prevent a false sense of enforcement,
 * which is the main risk this feature introduces.
 */
export function fileContractWarnings(input: ContractWarningInput): string[] {
  const out: string[] = [];

  if (input.status === 'invalid') {
    out.push(
      `File contract at ${input.path ?? '(unknown path)'} could not be parsed, so no path rules are in effect: ${input.error ?? 'unknown error'}`,
    );
    return out;
  }

  if (input.status !== 'loaded' || !input.contract) return out;

  const hasReadOrExecuteDeny =
    input.contract.defaults.read === 'deny' ||
    input.contract.defaults.execute === 'deny' ||
    input.contract.rules.some((r) => r.read === 'deny' || r.execute === 'deny');

  if (hasReadOrExecuteDeny && input.sandboxMode === 'danger-full-access') {
    out.push(
      'File contract denies reads, but the sandbox is off (danger-full-access). ' +
        'Those denials cover Read/Grep/Glob only — a shell command run through Bash can still ' +
        'reach the files. Set sandbox.mode to workspace-write to bound Bash too.',
    );
  }

  return out;
}
