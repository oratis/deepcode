// Right-side file panel (§3.11) — Mac client only.
// Inserts between the chat column and the 48px inspector rail. Presentational
// only: the parent (useFilePanel) owns the tabs/views/width state and the data
// fetching (file reads + session snapshots via Tauri). Every interaction is a
// callback so the component is unit-testable + previewable without a backend.

import type { DiffLine, DiffMode, FileTab, FileView } from '../types/file-panel.js';

interface FilePanelProps {
  tabs: FileTab[];
  activeIndex: number;
  view: FileView;
  diffMode: DiffMode;
  /** Current panel width (px); the parent persists it to settings.local.json. */
  width: number;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  onSelectView: (view: FileView) => void;
  onToggleDiffMode: () => void;
  onSelectHistory: (ts: number) => void;
  /** Mousedown on the left-edge resize grip — the parent runs the drag. */
  onResizeStart: (e: React.MouseEvent) => void;
}

const VIEWS: { id: FileView; label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'diff', label: 'Diff' },
  { id: 'history', label: 'History' },
];

export function FilePanel({
  tabs,
  activeIndex,
  view,
  diffMode,
  width,
  onSelectTab,
  onCloseTab,
  onSelectView,
  onToggleDiffMode,
  onSelectHistory,
  onResizeStart,
}: FilePanelProps): JSX.Element {
  const active = tabs[activeIndex] ?? tabs[0];

  return (
    <aside className="file-panel" style={{ width: `${width}px` }} data-testid="file-panel">
      <div className="fp-resize" onMouseDown={onResizeStart} title="Drag to resize" />

      {/* ── tab bar ─────────────────────────────────────────────── */}
      <div className="fp-tabs" role="tablist">
        {tabs.map((t, i) => (
          <div
            key={t.path}
            className={'fp-tab' + (i === activeIndex ? ' active' : '')}
            role="tab"
            aria-selected={i === activeIndex}
            title={t.path}
            onClick={() => onSelectTab(i)}
          >
            <span className="fp-tab-name">{basename(t.path)}</span>
            {t.unsaved && <span className="fp-tab-dot" title="Unsaved changes" />}
            <button
              type="button"
              className="fp-tab-close"
              title="Close tab (⌘W)"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(i);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* ── view switcher + per-view actions ────────────────────── */}
      <div className="fp-toolbar">
        <div className="fp-views" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={'fp-view-btn' + (view === v.id ? ' active' : '')}
              onClick={() => onSelectView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="fp-toolbar-spacer" />
        {view === 'diff' && (
          <button
            type="button"
            className="fp-action"
            title="Toggle split / inline (⌘\\)"
            onClick={onToggleDiffMode}
          >
            {diffMode === 'split' ? '⇆ Split' : '≡ Inline'}
          </button>
        )}
        {view === 'source' && (
          <button type="button" className="fp-action" title="Edit (read-only for now)">
            ✏
          </button>
        )}
      </div>

      {/* ── body ────────────────────────────────────────────────── */}
      <div className="fp-body">
        {!active ? (
          <p className="fp-empty">No file open.</p>
        ) : view === 'source' ? (
          <SourceView content={active.source} />
        ) : view === 'diff' ? (
          <DiffView lines={active.diff} mode={diffMode} />
        ) : (
          <HistoryView entries={active.history} onSelect={onSelectHistory} />
        )}
      </div>
    </aside>
  );
}

function SourceView({ content }: { content: string }): JSX.Element {
  const lines = content.split('\n');
  return (
    <div className="fp-source">
      {lines.map((ln, i) => (
        <div className="fp-line" key={i}>
          <span className="fp-ln">{i + 1}</span>
          <code className="fp-code">{ln === '' ? ' ' : ln}</code>
        </div>
      ))}
    </div>
  );
}

function DiffView({ lines, mode }: { lines: DiffLine[] | null; mode: DiffMode }): JSX.Element {
  if (!lines || lines.length === 0) {
    return <p className="fp-empty">No diff — this file hasn’t been edited this session.</p>;
  }
  if (mode === 'inline') {
    return (
      <div className="fp-diff inline">
        {lines.map((l, i) => (
          <div className={`fp-dline ${l.kind}`} key={i}>
            <span className="fp-ln old">{l.oldNo ?? ''}</span>
            <span className="fp-ln new">{l.newNo ?? ''}</span>
            <span className="fp-sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}</span>
            <code className="fp-code">{l.text === '' ? ' ' : l.text}</code>
          </div>
        ))}
      </div>
    );
  }
  // split: old (del+ctx) on the left, new (add+ctx) on the right, row-aligned.
  return (
    <div className="fp-diff split">
      {lines.map((l, i) => (
        <div className="fp-drow" key={i}>
          <div
            className={
              'fp-dcell left ' + (l.kind === 'del' ? 'del' : l.kind === 'ctx' ? '' : 'blank')
            }
          >
            {l.kind !== 'add' && (
              <>
                <span className="fp-ln">{l.oldNo ?? ''}</span>
                <code className="fp-code">{l.text === '' ? ' ' : l.text}</code>
              </>
            )}
          </div>
          <div
            className={
              'fp-dcell right ' + (l.kind === 'add' ? 'add' : l.kind === 'ctx' ? '' : 'blank')
            }
          >
            {l.kind !== 'del' && (
              <>
                <span className="fp-ln">{l.newNo ?? ''}</span>
                <code className="fp-code">{l.text === '' ? ' ' : l.text}</code>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryView({
  entries,
  onSelect,
}: {
  entries: FileTab['history'];
  onSelect: (ts: number) => void;
}): JSX.Element {
  if (entries.length === 0) {
    return <p className="fp-empty">No version history for this file yet.</p>;
  }
  return (
    <div className="fp-history">
      {entries.map((e) => (
        <button type="button" className="fp-hist-row" key={e.ts} onClick={() => onSelect(e.ts)}>
          <span className="fp-hist-dot" />
          <span className="fp-hist-label">{e.label}</span>
          <span className="fp-hist-tool">{e.tool}</span>
          <span className="fp-hist-ts">{fmtTime(e.ts)}</span>
        </button>
      ))}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────
function basename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
