// DEV-ONLY preview harness for the FilePanel (§3.11). Not part of the prod
// bundle — vite's build input is pinned to index.html, so this page only
// exists under `vite dev` (served at /preview.html) for visual iteration.
//
// Mounts FilePanel with mock fixtures + a working resize drag so the panel's
// appearance can be screenshotted without the Tauri backend.

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FilePanel } from './components/FilePanel.js';
import {
  clampPanelWidth,
  FILE_PANEL_DEFAULT_WIDTH,
  type DiffMode,
  type FileTab,
  type FileView,
} from './types/file-panel.js';
import './index.css';

const SAMPLE = `export function greet(name: string): string {
  // build the greeting
  const prefix = 'Hello';
  return prefix + ', ' + name + '!';
}

export const VERSION = '0.2.0';
`;

const MOCK_TABS: FileTab[] = [
  {
    path: '/Users/oratis/Projects/Claude/DeepCode/packages/core/src/greet.ts',
    source: SAMPLE,
    unsaved: true,
    diff: [
      { kind: 'ctx', oldNo: 1, newNo: 1, text: 'export function greet(name: string): string {' },
      { kind: 'del', oldNo: 2, newNo: null, text: "  return 'Hello ' + name;" },
      { kind: 'add', oldNo: null, newNo: 2, text: '  // build the greeting' },
      { kind: 'add', oldNo: null, newNo: 3, text: "  const prefix = 'Hello';" },
      { kind: 'add', oldNo: null, newNo: 4, text: "  return prefix + ', ' + name + '!';" },
      { kind: 'ctx', oldNo: 3, newNo: 5, text: '}' },
    ],
    history: [
      { ts: 1717286400000, tool: 'Edit', label: 'after Edit — add greeting prefix' },
      { ts: 1717286280000, tool: 'Edit', label: 'before Edit' },
      { ts: 1717286100000, tool: 'Write', label: 'initial Write' },
    ],
  },
  {
    path: '/Users/oratis/Projects/Claude/DeepCode/README.md',
    source: '# DeepCode\n\nA DeepSeek-driven coding agent.\n',
    diff: null,
    history: [],
  },
];

function Harness(): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);
  const [view, setView] = useState<FileView>('source');
  const [diffMode, setDiffMode] = useState<DiffMode>('inline');
  const [width, setWidth] = useState(FILE_PANEL_DEFAULT_WIDTH);

  const onResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: MouseEvent): void =>
      setWidth(clampPanelWidth(startW + (startX - ev.clientX)));
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-1)' }}>
      <div
        style={{ flex: 1, padding: 24, color: 'var(--text-2)', fontFamily: 'Inter, sans-serif' }}
      >
        <div style={{ fontSize: 13 }}>‹ chat column (mock) — width {width}px</div>
      </div>
      <FilePanel
        tabs={MOCK_TABS}
        activeIndex={activeIndex}
        view={view}
        diffMode={diffMode}
        width={width}
        onSelectTab={setActiveIndex}
        onCloseTab={() => {}}
        onSelectView={setView}
        onToggleDiffMode={() => setDiffMode((m) => (m === 'split' ? 'inline' : 'split'))}
        onSelectHistory={() => {}}
        onResizeStart={onResizeStart}
      />
      <div style={{ width: 48, background: 'var(--bg-1)', borderLeft: '1px solid var(--line)' }} />
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<Harness />);
