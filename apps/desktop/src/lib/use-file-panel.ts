// React hook wiring the pure file-panel reducer to side effects: reading file
// contents (Source view), persisting the panel width, and the ⌘O / ⌘[ / ⌘]
// keybindings. The ⌘\ split/inline toggle is owned by App (it shares the chord
// with the inspector toggle and resolves contextually).
//
// Diff/History data is left empty here — those are backed by session snapshots,
// wired in a follow-up. The component shows honest empty states meanwhile.

import { useCallback, useEffect, useReducer } from 'react';
import { pickFile, toolRead } from './tauri-api.js';
import { registerShortcut } from './keyboard.js';
import { filePanelReducer, initialFilePanelState } from './file-panel-reducer.js';
import type { FileView } from '../types/file-panel.js';

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
  setWidth: (width: number) => void;
}

export function useFilePanel(): UseFilePanel {
  const [state, dispatch] = useReducer(filePanelReducer, loadWidth(), initialFilePanelState);

  const open = useCallback(async (path: string): Promise<void> => {
    let source: string;
    try {
      source = await toolRead(path);
    } catch (e) {
      source = `// Could not read ${path}\n// ${String(e)}`;
    }
    dispatch({ type: 'open', tab: { path, source, diff: null, history: [] } });
  }, []);

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
    setWidth,
  };
}
