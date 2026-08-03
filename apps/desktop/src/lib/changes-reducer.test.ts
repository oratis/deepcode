import { describe, expect, it } from 'vitest';
import {
  appliedAction,
  changesBadge,
  changesReducer,
  initialChangesState,
  pendingFindings,
  type ChangedFile,
  type ChangesState,
  type ReviewFinding,
} from './changes-reducer.js';

const finding = (id: string, extra: Partial<ReviewFinding> = {}): ReviewFinding => ({
  findingId: id,
  title: `finding ${id}`,
  body: '',
  path: `src/${id}.ts`,
  startLine: 1,
  endLine: 2,
  priority: 2,
  replacement: 'fixed',
  ...extra,
});

const file = (path: string): ChangedFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  binary: false,
  truncated: false,
  hunks: [],
});

const reduce = (state: ChangesState, ...events: Parameters<typeof changesReducer>[1][]) =>
  events.reduce(changesReducer, state);

describe('diff loading', () => {
  it('clears a previous error when a new load starts', () => {
    const errored = changesReducer(initialChangesState, {
      type: 'diff-failed',
      message: 'boom',
    });
    expect(changesReducer(errored, { type: 'diff-requested' }).error).toBeNull();
  });

  it('distinguishes "not loaded" from "clean"', () => {
    expect(initialChangesState.files).toBeNull();
    const loaded = changesReducer(initialChangesState, {
      type: 'diff-loaded',
      repository: true,
      files: [],
      truncated: false,
    });
    expect(loaded.files).toEqual([]);
  });

  it('drops expansions for files that are no longer changed', () => {
    const state = reduce(
      initialChangesState,
      {
        type: 'diff-loaded',
        repository: true,
        files: [file('a.ts'), file('b.ts')],
        truncated: false,
      },
      { type: 'toggle-file', path: 'a.ts' },
      { type: 'toggle-file', path: 'b.ts' },
      { type: 'diff-loaded', repository: true, files: [file('b.ts')], truncated: false },
    );
    expect(state.expanded).toEqual(['b.ts']);
  });

  it('toggles a file open and shut', () => {
    const open = changesReducer(initialChangesState, { type: 'toggle-file', path: 'a.ts' });
    expect(open.expanded).toEqual(['a.ts']);
    expect(changesReducer(open, { type: 'toggle-file', path: 'a.ts' }).expanded).toEqual([]);
  });
});

describe('findings', () => {
  it('accumulates findings across turns', () => {
    const state = reduce(
      initialChangesState,
      { type: 'finding', finding: finding('f1') },
      { type: 'finding', finding: finding('f2') },
    );
    expect(state.findings.map((f) => f.findingId)).toEqual(['f1', 'f2']);
  });

  it('ignores a replayed finding when a thread is re-read', () => {
    const state = reduce(
      initialChangesState,
      { type: 'finding', finding: finding('f1') },
      { type: 'finding', finding: finding('f1') },
    );
    expect(state.findings).toHaveLength(1);
  });

  it('marks a finding applied once its action arrives, and clears the spinner', () => {
    const state = reduce(
      initialChangesState,
      { type: 'finding', finding: finding('f1') },
      { type: 'apply-started', findingIds: ['f1'] },
      { type: 'action', action: { actionId: 'a1', findingIds: ['f1'], kind: 'apply' } },
    );
    expect(state.applying).toEqual([]);
    expect(appliedAction(state, 'f1')?.actionId).toBe('a1');
    expect(pendingFindings(state)).toHaveLength(0);
  });

  it('returns a reverted finding to the pending list', () => {
    const state = reduce(
      initialChangesState,
      { type: 'finding', finding: finding('f1') },
      { type: 'action', action: { actionId: 'a1', findingIds: ['f1'], kind: 'apply' } },
      { type: 'action', action: { actionId: 'a2', findingIds: ['f1'], kind: 'revert' } },
    );
    expect(appliedAction(state, 'f1')).toBeUndefined();
    expect(pendingFindings(state).map((f) => f.findingId)).toEqual(['f1']);
  });

  it('handles a batched apply covering several findings', () => {
    const state = reduce(
      initialChangesState,
      { type: 'finding', finding: finding('f1') },
      { type: 'finding', finding: finding('f2') },
      { type: 'action', action: { actionId: 'a1', findingIds: ['f1', 'f2'], kind: 'apply' } },
    );
    expect(pendingFindings(state)).toHaveLength(0);
  });

  it('clears the spinner when an apply fails without producing an action', () => {
    const state = reduce(
      initialChangesState,
      { type: 'apply-started', findingIds: ['f1'] },
      { type: 'apply-settled', findingIds: ['f1'] },
    );
    expect(state.applying).toEqual([]);
  });

  it('does not double-count a replayed action', () => {
    const action = { actionId: 'a1', findingIds: ['f1'], kind: 'apply' as const };
    const state = reduce(
      initialChangesState,
      { type: 'action', action },
      { type: 'action', action },
    );
    expect(state.actions).toHaveLength(1);
  });
});

describe('changesBadge', () => {
  it('counts findings still to act on ahead of changed files', () => {
    const state = reduce(
      initialChangesState,
      {
        type: 'diff-loaded',
        repository: true,
        files: [file('a.ts'), file('b.ts')],
        truncated: false,
      },
      { type: 'finding', finding: finding('f1') },
    );
    expect(changesBadge(state)).toBe(1);
  });

  it('falls back to the changed-file count when nothing is pending', () => {
    const state = changesReducer(initialChangesState, {
      type: 'diff-loaded',
      repository: true,
      files: [file('a.ts'), file('b.ts')],
      truncated: false,
    });
    expect(changesBadge(state)).toBe(2);
  });

  it('is zero on a clean tree with no findings', () => {
    expect(changesBadge(initialChangesState)).toBe(0);
  });
});

describe('clearing', () => {
  it('resets everything when the conversation changes', () => {
    const state = reduce(
      initialChangesState,
      { type: 'finding', finding: finding('f1') },
      { type: 'diff-loaded', repository: true, files: [file('a.ts')], truncated: false },
      { type: 'cleared' },
    );
    expect(state).toEqual(initialChangesState);
  });
});
