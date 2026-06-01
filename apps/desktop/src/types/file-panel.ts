// Right-side file panel (§3.11) — types shared by the presentational
// FilePanel component, its useFilePanel state hook, and the diff util.
//
// The panel is PURELY presentational: it renders whatever tabs/views the
// parent hands it and calls back for every interaction. Data fetching
// (reading files + session snapshots via Tauri) lives in the parent so the
// component stays unit-testable + previewable without a Tauri backend.

export type FileView = 'source' | 'diff' | 'history';
export type DiffMode = 'split' | 'inline';

/** One rendered line of a unified/side-by-side diff. */
export interface DiffLine {
  kind: 'add' | 'del' | 'ctx';
  /** 1-based line number in the OLD revision (null for added lines). */
  oldNo: number | null;
  /** 1-based line number in the NEW revision (null for deleted lines). */
  newNo: number | null;
  text: string;
}

/** One entry in a file's session version timeline (newest first). */
export interface FileHistoryEntry {
  /** Snapshot timestamp (unix ms). */
  ts: number;
  /** Tool that produced the snapshot. */
  tool: string;
  /** Human label, e.g. "before Edit" / "after Write". */
  label: string;
}

/** One open file tab. */
export interface FileTab {
  /** Absolute path (the tab identity). */
  path: string;
  /** Current source content (Source view). */
  source: string;
  /** Precomputed diff vs the last Edit/Write, or null when none exists. */
  diff: DiffLine[] | null;
  /** Session version timeline, newest first. */
  history: FileHistoryEntry[];
  /** Show the unsaved-changes yellow dot. */
  unsaved?: boolean;
}

/** Persisted-ish panel UI state (width persists to settings.local.json). */
export interface FilePanelState {
  tabs: FileTab[];
  activeIndex: number;
  view: FileView;
  diffMode: DiffMode;
  width: number;
}

export const FILE_PANEL_MIN_WIDTH = 320;
export const FILE_PANEL_MAX_WIDTH = 800;
export const FILE_PANEL_DEFAULT_WIDTH = 520;

/** Clamp a width to the spec's 320–800px range. */
export function clampPanelWidth(w: number): number {
  return Math.max(FILE_PANEL_MIN_WIDTH, Math.min(FILE_PANEL_MAX_WIDTH, Math.round(w)));
}
