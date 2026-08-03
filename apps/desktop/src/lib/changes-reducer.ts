// State for the Changes panel: the working-tree diff and the review findings
// the agent has submitted, plus the apply/revert actions taken on them.
//
// Pure reducer — the hook owns the protocol calls and the subscription; this
// file owns what the panel shows. Findings arrive as protocol events during a
// turn and must survive the turn ending, so they accumulate here rather than
// living in the chat transcript.

/** Mirrors the protocol's ReviewFindingPayload — apply() sends it straight back. */
export interface ReviewFinding {
  findingId: string;
  title: string;
  body: string;
  path: string;
  startLine: number;
  endLine: number;
  priority: 0 | 1 | 2 | 3;
  replacement?: string;
}

export interface ReviewAction {
  actionId: string;
  findingIds: string[];
  /** 'apply' creates changes; 'revert' undoes an earlier apply. */
  kind: 'apply' | 'revert';
}

export interface DiffLine {
  kind: 'context' | 'addition' | 'deletion';
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface ChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  truncated: boolean;
  hunks: DiffHunk[];
}

export interface ChangesState {
  /** null until the first load; [] means a clean tree. */
  files: ChangedFile[] | null;
  repository: boolean;
  diffTruncated: boolean;
  loading: boolean;
  error: string | null;
  findings: ReviewFinding[];
  actions: ReviewAction[];
  /** Findings whose apply is in flight — the row shows a spinner, not a button. */
  applying: string[];
  expanded: string[];
}

export const initialChangesState: ChangesState = {
  files: null,
  repository: true,
  diffTruncated: false,
  loading: false,
  error: null,
  findings: [],
  actions: [],
  applying: [],
  expanded: [],
};

export type ChangesEvent =
  | { type: 'diff-requested' }
  | {
      type: 'diff-loaded';
      repository: boolean;
      files: ChangedFile[];
      truncated: boolean;
    }
  | { type: 'diff-failed'; message: string }
  | { type: 'finding'; finding: ReviewFinding }
  | { type: 'action'; action: ReviewAction }
  | { type: 'apply-started'; findingIds: string[] }
  | { type: 'apply-settled'; findingIds: string[] }
  | { type: 'toggle-file'; path: string }
  | { type: 'cleared' };

export function changesReducer(state: ChangesState, event: ChangesEvent): ChangesState {
  switch (event.type) {
    case 'diff-requested':
      return { ...state, loading: true, error: null };

    case 'diff-loaded':
      return {
        ...state,
        loading: false,
        error: null,
        repository: event.repository,
        files: event.files,
        diffTruncated: event.truncated,
        // Drop expansions for files that are no longer changed, so a stale
        // path can't keep a row open against a file that reverted.
        expanded: state.expanded.filter((p) => event.files.some((f) => f.path === p)),
      };

    case 'diff-failed':
      return { ...state, loading: false, error: event.message };

    case 'finding':
      // The same finding can be replayed when a thread is re-read; keep one.
      return state.findings.some((f) => f.findingId === event.finding.findingId)
        ? state
        : { ...state, findings: [...state.findings, event.finding] };

    case 'action':
      return state.actions.some((a) => a.actionId === event.action.actionId)
        ? state
        : {
            ...state,
            actions: [...state.actions, event.action],
            applying: state.applying.filter((id) => !event.action.findingIds.includes(id)),
          };

    case 'apply-started':
      return { ...state, applying: [...new Set([...state.applying, ...event.findingIds])] };

    case 'apply-settled':
      return { ...state, applying: state.applying.filter((id) => !event.findingIds.includes(id)) };

    case 'toggle-file':
      return {
        ...state,
        expanded: state.expanded.includes(event.path)
          ? state.expanded.filter((p) => p !== event.path)
          : [...state.expanded, event.path],
      };

    case 'cleared':
      return { ...initialChangesState };
  }
}

/** The apply action covering a finding, if one succeeded and wasn't reverted. */
export function appliedAction(state: ChangesState, findingId: string): ReviewAction | undefined {
  const apply = [...state.actions]
    .reverse()
    .find((a) => a.kind === 'apply' && a.findingIds.includes(findingId));
  if (!apply) return undefined;
  const reverted = state.actions.some(
    (a) => a.kind === 'revert' && a.findingIds.includes(findingId),
  );
  return reverted ? undefined : apply;
}

/** Findings with no surviving apply — what "Apply all" would act on. */
export function pendingFindings(state: ChangesState): ReviewFinding[] {
  return state.findings.filter((f) => !appliedAction(state, f.findingId));
}

/** Rail badge: findings still to act on, else the number of changed files. */
export function changesBadge(state: ChangesState): number {
  const pending = pendingFindings(state).length;
  return pending > 0 ? pending : (state.files?.length ?? 0);
}
