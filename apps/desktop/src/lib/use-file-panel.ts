// React hook wiring the pure file-panel reducer to side effects: reading file
// contents (Source view), fetching session snapshots for the Diff/History tabs,
// persisting the panel width, and the ⌘O / ⌘[ / ⌘] keybindings. The ⌘\
// split/inline toggle is owned by App (it shares the chord with the inspector
// toggle and resolves contextually).
//
// Diff/History come from session snapshots captured on the Rust side for every
// Edit/Write (see src-tauri/src/snapshots.rs). On open() we fetch a file's
// snapshots and derive: the History timeline, and a Diff of the current file
// vs the session baseline (its oldest snapshot). Selecting a History entry
// recomputes the Diff against that revision.

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { pickFile, sessionSnapshots, toolRead, type SessionSnapshot } from './tauri-api.js';
import { getActiveSessionId } from './mac-session.js';
import { registerShortcut } from './keyboard.js';
import { filePanelReducer, initialFilePanelState } from './file-panel-reducer.js';
import { computeLineDiff } from './diff.js';
import { baselineContent, buildHistory, contentAt } from './file-history.js';
import type { DiffLine, FileHistoryEntry, FileView } from '../types/file-panel.js';

const WIDTH_KEY = 'deepcode.filePanel.width';

function loadWidth(): number | undefined {
  try {
    const v = localStorage.getItem(WIDTH_KEY);
    return v ? Number(v) : undefined;
  } catch {
    return undefined;
  }
}

export interface UseFilePanel {
  state: ReturnType<typeof initialFilePanelState>;
  isOpen: boolean;
  open: (path: string) => Promise<void>;
  openViaPicker: () => Promise<void>;
  close: (index: number) => void;
  closeActive: () => void;
  select: (index: number) => void;
  setView: (view: FileView) => void;
  toggleDiffMode: () => void;
  /** Show the diff of the active file vs the snapshot captured at `ts`. */
  selectHistory: (ts: number) => void;
  setWidth: (width: number) => void;
}

export function useFilePanel(): UseFilePanel {
  const [state, dispatch] = useReducer(filePanelReducer, loadWidth(), initialFilePanelState);
  // Per-path snapshot cache (with blob contents) so selectHistory can recompute
  // a diff without re-hitting Tauri. Refreshed on every open().
  const snapsByPath = useRef(new Map<string, SessionSnapshot[]>());

  const open = useCallback(async (path: string): Promise<void> => {
    let source: string;
    try {
      source = await toolRead(path);
    } catch (e) {
      source = `// Could not read ${path}\n// ${String(e)}`;
    }
    // Pull this file's session snapshots → History timeline + a Diff of the
    // current content vs the session baseline. All best-effort: no session yet,
    // or no snapshots, leaves the honest empty states in place.
    let history: FileHistoryEntry[] = [];
    let diff: DiffLine[] | null = null;
    const sessionId = getActiveSessionId();
    if (sessionId) {
      try {
        const snaps = await sessionSnapshots(sessionId, path);
        snapsByPath.current.set(path, snaps);
        history = buildHistory(snaps);
        const base = baselineContent(snaps);
        if (base !== null) diff = computeLineDiff(base, source);
      } catch {
        /* snapshots unavailable — leave empty states */
      }
    }
    dispatch({ type: 'open', tab: { path, source, diff, history } });
  }, []);

  const selectHistory = useCallback(
    (ts: number): void => {
      const tab = state.tabs[state.activeIndex];
      if (!tab) return;
      const snaps = snapsByPath.current.get(tab.path);
      const revision = snaps ? contentAt(snaps, ts) : null;
      if (revision === null) return;
      // Diff the chosen revision → current file, then jump to the Diff view.
      dispatch({ type: 'setDiff', path: tab.path, diff: computeLineDiff(revision, tab.source) });
      dispatch({ type: 'view', view: 'diff' });
    },
    [state.tabs, state.activeIndex],
  );

  const openViaPicker = useCallback(async (): Promise<void> => {
    try {
      const p = await pickFile();
      if (p) await open(p);
    } catch {
      /* picker cancelled */
    }
  }, [open]);

  const close = useCallback((index: number) => dispatch({ type: 'close', index }), []);
  const select = useCallback((index: number) => dispatch({ type: 'select', index }), []);
  const setView = useCallback((view: FileView) => dispatch({ type: 'view', view }), []);
  const toggleDiffMode = useCallback(() => dispatch({ type: 'toggleDiffMode' }), []);
  const setWidth = useCallback((width: number) => dispatch({ type: 'width', width }), []);

  // Persist the panel width across launches.
  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(state.width));
    } catch {
      /* storage unavailable */
    }
  }, [state.width]);

  // ⌘O open a file · ⌘[ / ⌘] previous/next tab.
  useEffect(() => {
    const offOpen = registerShortcut('meta+o', () => void openViaPicker());
    const offPrev = registerShortcut('meta+[', () => dispatch({ type: 'prevTab' }));
    const offNext = registerShortcut('meta+]', () => dispatch({ type: 'nextTab' }));
    return () => {
      offOpen();
      offPrev();
      offNext();
    };
  }, [openViaPicker]);

  const closeActive = useCallback(
    () => dispatch({ type: 'close', index: state.activeIndex }),
    [state.activeIndex],
  );

  return {
    state,
    isOpen: state.tabs.length > 0,
    open,
    openViaPicker,
    close,
    closeActive,
    select,
    setView,
    toggleDiffMode,
    selectHistory,
    setWidth,
  };
}
