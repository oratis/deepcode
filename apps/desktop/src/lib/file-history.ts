// Pure helpers that turn a file's session snapshots (from the `session_snapshots`
// Tauri command) into the file panel's History timeline + Diff baseline. Kept
// free of React/Tauri so the mapping is unit-testable in isolation.

import type { FileHistoryEntry } from '../types/file-panel.js';
import type { SessionSnapshot } from './tauri-api.js';

/** "pre-Edit" / "post-Write" → the tool name ("Edit" / "Write"). */
export function toolFromReason(reason: string): string {
  const dash = reason.indexOf('-');
  return dash >= 0 ? reason.slice(dash + 1) : reason;
}

/** "pre-Edit" → "before Edit", "post-Write" → "after Write". */
export function labelFromReason(reason: string): string {
  const tool = toolFromReason(reason);
  if (reason.startsWith('pre')) return `before ${tool}`;
  if (reason.startsWith('post')) return `after ${tool}`;
  return reason;
}

/**
 * Build the newest-first version timeline. Snapshots arrive seq-ascending; we
 * collapse consecutive identical-content rows — a mutation's post-blob equals
 * the next mutation's pre-blob, so the same file state would otherwise appear
 * twice in a row — then reverse to newest-first for display.
 */
export function buildHistory(snaps: SessionSnapshot[]): FileHistoryEntry[] {
  const deduped: SessionSnapshot[] = [];
  for (const s of snaps) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.hash === s.hash) continue;
    deduped.push(s);
  }
  return deduped
    .map((s) => ({
      ts: s.capturedAtMs,
      tool: toolFromReason(s.reason),
      label: labelFromReason(s.reason),
    }))
    .reverse();
}

/**
 * The Diff view's baseline = the OLDEST captured content for this file (the
 * pre-state of the first edit this session). Diffing it against the current
 * file shows the conversation's NET change to the file. Returns null when the
 * file has no snapshots (never edited this session).
 */
export function baselineContent(snaps: SessionSnapshot[]): string | null {
  return snaps.length > 0 ? snaps[0].content : null;
}

/** A snapshot's content by its capturedAt ms (a History row's identity). */
export function contentAt(snaps: SessionSnapshot[], ts: number): string | null {
  const s = snaps.find((x) => x.capturedAtMs === ts);
  return s ? s.content : null;
}
