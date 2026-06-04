// Pure state machine for the right-side file panel (§3.11). Kept separate from
// the React hook so the tab/view/width transitions are unit-testable without a
// renderer. The hook (useFilePanel) wraps this with useReducer + side effects
// (reading files, persisting width, keybindings).

import {
  clampPanelWidth,
  type DiffLine,
  FILE_PANEL_DEFAULT_WIDTH,
  type FilePanelState,
  type FileTab,
  type FileView,
} from '../types/file-panel.js';

export type FilePanelAction =
  | { type: 'open'; tab: FileTab }
  | { type: 'close'; index: number }
  | { type: 'select'; index: number }
  | { type: 'view'; view: FileView }
  | { type: 'toggleDiffMode' }
  | { type: 'width'; width: number }
  | { type: 'nextTab' }
  | { type: 'prevTab' }
  // Replace a tab's precomputed diff (selecting a History entry recomputes it
  // against the chosen revision). No-op when the path isn't open.
  | { type: 'setDiff'; path: string; diff: DiffLine[] | null };

export function initialFilePanelState(width = FILE_PANEL_DEFAULT_WIDTH): FilePanelState {
  return {
    tabs: [],
    activeIndex: 0,
    view: 'source',
    diffMode: 'inline',
    width: clampPanelWidth(width),
  };
}

export function filePanelReducer(state: FilePanelState, action: FilePanelAction): FilePanelState {
  switch (action.type) {
    case 'open': {
      // Re-opening an already-open file refreshes its data + activates it.
      const existing = state.tabs.findIndex((t) => t.path === action.tab.path);
      if (existing >= 0) {
        const tabs = state.tabs.slice();
        tabs[existing] = action.tab;
        return { ...state, tabs, activeIndex: existing };
      }
      return { ...state, tabs: [...state.tabs, action.tab], activeIndex: state.tabs.length };
    }
    case 'close': {
      if (action.index < 0 || action.index >= state.tabs.length) return state;
      const tabs = state.tabs.filter((_, i) => i !== action.index);
      let activeIndex = state.activeIndex;
      if (action.index < activeIndex) activeIndex -= 1;
      if (activeIndex >= tabs.length) activeIndex = tabs.length - 1;
      if (activeIndex < 0) activeIndex = 0;
      return { ...state, tabs, activeIndex };
    }
    case 'select':
      if (action.index < 0 || action.index >= state.tabs.length) return state;
      return { ...state, activeIndex: action.index };
    case 'view':
      return { ...state, view: action.view };
    case 'toggleDiffMode':
      return { ...state, diffMode: state.diffMode === 'split' ? 'inline' : 'split' };
    case 'width':
      return { ...state, width: clampPanelWidth(action.width) };
    case 'setDiff': {
      const idx = state.tabs.findIndex((t) => t.path === action.path);
      if (idx < 0) return state;
      const tabs = state.tabs.slice();
      tabs[idx] = { ...tabs[idx], diff: action.diff };
      return { ...state, tabs };
    }
    case 'nextTab':
      if (state.tabs.length === 0) return state;
      return { ...state, activeIndex: (state.activeIndex + 1) % state.tabs.length };
    case 'prevTab':
      if (state.tabs.length === 0) return state;
      return {
        ...state,
        activeIndex: (state.activeIndex - 1 + state.tabs.length) % state.tabs.length,
      };
    default:
      return state;
  }
}
