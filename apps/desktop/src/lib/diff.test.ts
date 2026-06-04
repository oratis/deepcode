import { describe, expect, it } from 'vitest';
import { computeLineDiff, hasChanges } from './diff.js';
import type { DiffLine } from '../types/file-panel.js';

/** Compact a diff to "<sign><text>" rows for readable assertions. */
function sigs(lines: DiffLine[]): string[] {
  const sign = (k: DiffLine['kind']): string => (k === 'add' ? '+' : k === 'del' ? '-' : ' ');
  return lines.map((l) => `${sign(l.kind)}${l.text}`);
}

describe('computeLineDiff', () => {
  it('returns all-context for identical input (and hasChanges is false)', () => {
    const d = computeLineDiff('a\nb\nc', 'a\nb\nc');
    expect(sigs(d)).toEqual([' a', ' b', ' c']);
    expect(hasChanges(d)).toBe(false);
  });

  it('detects a single inserted line with correct line numbers', () => {
    const d = computeLineDiff('a\nc', 'a\nb\nc');
    expect(sigs(d)).toEqual([' a', '+b', ' c']);
    // context line numbers advance on both sides; the add has no oldNo.
    expect(d[0]).toMatchObject({ kind: 'ctx', oldNo: 1, newNo: 1 });
    expect(d[1]).toMatchObject({ kind: 'add', oldNo: null, newNo: 2 });
    expect(d[2]).toMatchObject({ kind: 'ctx', oldNo: 2, newNo: 3 });
  });

  it('detects a deleted line', () => {
    const d = computeLineDiff('a\nb\nc', 'a\nc');
    expect(sigs(d)).toEqual([' a', '-b', ' c']);
    expect(d[1]).toMatchObject({ kind: 'del', oldNo: 2, newNo: null });
  });

  it('represents a changed line as a delete + add pair', () => {
    const d = computeLineDiff('x = 1', 'x = 2');
    expect(sigs(d)).toEqual(['-x = 1', '+x = 2']);
    expect(hasChanges(d)).toBe(true);
  });

  it('handles empty → content as all adds (new file)', () => {
    const d = computeLineDiff('', 'line1\nline2');
    expect(sigs(d)).toEqual(['+line1', '+line2']);
    expect(d.every((l) => l.kind === 'add' && l.oldNo === null)).toBe(true);
  });

  it('handles content → empty as all deletes', () => {
    const d = computeLineDiff('line1\nline2', '');
    expect(sigs(d)).toEqual(['-line1', '-line2']);
  });

  it('keeps newNo monotonic across mixed adds/deletes', () => {
    const d = computeLineDiff('a\nb\nc\nd', 'a\nB\nc\nD\ne');
    expect(sigs(d)).toEqual([' a', '-b', '+B', ' c', '-d', '+D', '+e']);
    const newNos = d.filter((l) => l.newNo !== null).map((l) => l.newNo);
    expect(newNos).toEqual([1, 2, 3, 4, 5]);
    const oldNos = d.filter((l) => l.oldNo !== null).map((l) => l.oldNo);
    expect(oldNos).toEqual([1, 2, 3, 4]);
  });

  it('returns [] for two empty strings', () => {
    expect(computeLineDiff('', '')).toEqual([]);
  });
});
