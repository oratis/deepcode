// Pure line differ for the file panel's Diff view. Produces a full (un-hunked)
// unified diff as DiffLine[] — the FilePanel renders inline or split from the
// same rows. Kept dependency-free + side-effect-free so it's trivially testable.
//
// Algorithm: classic longest-common-subsequence over lines, then a backtrack
// that emits ctx / del / add rows with running old/new line numbers. Lines are
// split on '\n' to match how SourceView numbers the file, so a diff row's
// oldNo/newNo line up with the Source view.

import type { DiffLine } from '../types/file-panel.js';

// LCS builds an (n+1)×(m+1) table. Cap the cell count so a pathologically large
// pair can't blow up memory; beyond it we fall back to a naive replace-all diff
// (every old line deleted, every new line added). Real source files are far
// under this (a 4000×4000 diff = 16M cells ≈ 64MB Int32Array, transient).
const MAX_CELLS = 16_000_000;

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  // An empty string is zero lines, not one empty line — otherwise diffing an
  // empty baseline (e.g. a brand-new file's pre-snapshot) emits a phantom
  // "delete empty line" row before the real additions.
  const a = oldText === '' ? [] : oldText.split('\n');
  const b = newText === '' ? [] : newText.split('\n');
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if ((n + 1) * (m + 1) > MAX_CELLS) return naiveDiff(a, b);

  // dp[i*w + j] = LCS length of a[i..] and b[j..]; filled bottom-up.
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      out.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: a[i] });
      i++;
    } else {
      out.push({ kind: 'add', oldNo: null, newNo: newNo++, text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: a[i++] });
  while (j < m) out.push({ kind: 'add', oldNo: null, newNo: newNo++, text: b[j++] });
  return out;
}

/** Whole-file replacement diff — fallback for oversized inputs. */
function naiveDiff(a: string[], b: string[]): DiffLine[] {
  const out: DiffLine[] = [];
  a.forEach((text, i) => out.push({ kind: 'del', oldNo: i + 1, newNo: null, text }));
  b.forEach((text, i) => out.push({ kind: 'add', oldNo: null, newNo: i + 1, text }));
  return out;
}

/** True when a diff has at least one add/del (i.e. the two revisions differ). */
export function hasChanges(lines: DiffLine[]): boolean {
  return lines.some((l) => l.kind !== 'ctx');
}
