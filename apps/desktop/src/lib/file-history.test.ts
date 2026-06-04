import { describe, expect, it } from 'vitest';
import {
  baselineContent,
  buildHistory,
  contentAt,
  labelFromReason,
  toolFromReason,
} from './file-history.js';
import type { SessionSnapshot } from './tauri-api.js';

// Two edits: original A → B → C. Core captures pre+post per edit, so the
// post-of-edit-1 (B) and pre-of-edit-2 (B) share a hash/content.
const SNAPS: SessionSnapshot[] = [
  { seq: 0, capturedAtMs: 1000, reason: 'pre-Edit', hash: 'hA', content: 'A\n' },
  { seq: 1, capturedAtMs: 1001, reason: 'post-Edit', hash: 'hB', content: 'B\n' },
  { seq: 2, capturedAtMs: 2000, reason: 'pre-Edit', hash: 'hB', content: 'B\n' },
  { seq: 3, capturedAtMs: 2001, reason: 'post-Edit', hash: 'hC', content: 'C\n' },
];

describe('reason parsing', () => {
  it('extracts tool + label', () => {
    expect(toolFromReason('pre-Edit')).toBe('Edit');
    expect(toolFromReason('post-Write')).toBe('Write');
    expect(labelFromReason('pre-Edit')).toBe('before Edit');
    expect(labelFromReason('post-Write')).toBe('after Write');
  });
});

describe('buildHistory', () => {
  it('collapses the duplicate B state and lists newest-first', () => {
    const h = buildHistory(SNAPS);
    // A(pre), B(post), [B(pre) collapsed], C(post) → reversed
    expect(h.map((e) => e.label)).toEqual(['after Edit', 'after Edit', 'before Edit']);
    expect(h.map((e) => e.ts)).toEqual([2001, 1001, 1000]);
    expect(h.every((e) => e.tool === 'Edit')).toBe(true);
  });

  it('is empty for no snapshots', () => {
    expect(buildHistory([])).toEqual([]);
  });
});

describe('baselineContent', () => {
  it('is the oldest snapshot content', () => {
    expect(baselineContent(SNAPS)).toBe('A\n');
  });
  it('is null when there are no snapshots', () => {
    expect(baselineContent([])).toBeNull();
  });
});

describe('contentAt', () => {
  it('finds a snapshot content by its ms timestamp', () => {
    expect(contentAt(SNAPS, 2001)).toBe('C\n');
    expect(contentAt(SNAPS, 1000)).toBe('A\n');
  });
  it('is null for an unknown timestamp', () => {
    expect(contentAt(SNAPS, 999)).toBeNull();
  });
});
