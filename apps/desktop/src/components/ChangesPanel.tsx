// Right-side Changes panel — review findings on top, working-tree diff below.
//
// Presentational: the parent (useChanges) owns fetching, the protocol calls and
// the reducer. Every interaction is a callback so the panel is previewable and
// testable without a backend.

import type { JSX } from 'react';
import {
  appliedAction,
  pendingFindings,
  type ChangedFile,
  type ChangesState,
  type ReviewFinding,
} from '../lib/changes-reducer.js';

interface ChangesPanelProps {
  state: ChangesState;
  width: number;
  onRefresh: () => void;
  onToggleFile: (path: string) => void;
  onApply: (findings: ReviewFinding[]) => void;
  onRevert: (actionId: string) => void;
  onOpenFile?: (path: string) => void;
  onResizeStart: (e: React.MouseEvent) => void;
}

const PRIORITY_LABEL = ['blocker', 'high', 'medium', 'low'] as const;

export function ChangesPanel({
  state,
  width,
  onRefresh,
  onToggleFile,
  onApply,
  onRevert,
  onOpenFile,
  onResizeStart,
}: ChangesPanelProps): JSX.Element {
  const pending = pendingFindings(state);

  return (
    <aside className="changes-panel" style={{ width: `${width}px` }} data-testid="changes-panel">
      <div className="fp-resize" onMouseDown={onResizeStart} title="Drag to resize" />

      <div className="ch-head">
        <span className="ch-title">Changes</span>
        <button type="button" className="ch-btn" onClick={onRefresh} disabled={state.loading}>
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {state.error && <div className="ch-error">{state.error}</div>}

      {state.findings.length > 0 && (
        <section className="ch-section">
          <div className="ch-section-head">
            <h5>
              Review findings
              {pending.length > 0 ? ` · ${pending.length} to apply` : ' · all applied'}
            </h5>
            {pending.length > 1 && (
              <button type="button" className="ch-btn" onClick={() => onApply(pending)}>
                Apply all
              </button>
            )}
          </div>
          {state.findings.map((f) => {
            const action = appliedAction(state, f.findingId);
            const busy = state.applying.includes(f.findingId);
            return (
              <div className="ch-finding" key={f.findingId}>
                <div className="ch-finding-head">
                  <span className={`ch-prio p${f.priority}`}>
                    {PRIORITY_LABEL[f.priority] ?? 'note'}
                  </span>
                  <button
                    type="button"
                    className="ch-path"
                    title={`Open ${f.path}`}
                    onClick={() => onOpenFile?.(f.path)}
                  >
                    {f.path}
                    {f.startLine > 0 ? `:${f.startLine}` : ''}
                  </button>
                </div>
                <div className="ch-finding-title">{f.title}</div>
                {f.body && <div className="ch-finding-body">{f.body}</div>}
                <div className="ch-finding-actions">
                  {action ? (
                    <>
                      <span className="ch-applied">applied</span>
                      <button
                        type="button"
                        className="ch-btn"
                        onClick={() => onRevert(action.actionId)}
                      >
                        Revert
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ch-btn primary"
                      disabled={busy || !f.replacement}
                      title={
                        f.replacement
                          ? 'Apply this finding as a normal, permission-gated turn'
                          : 'This finding has no suggested replacement to apply'
                      }
                      onClick={() => onApply([f])}
                    >
                      {busy ? 'Applying…' : 'Apply'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="ch-section">
        <h5>Working tree</h5>
        {!state.repository ? (
          <p className="ch-empty">Not a Git repository.</p>
        ) : state.files === null ? (
          <p className="ch-empty">{state.loading ? 'Reading…' : 'Not loaded yet.'}</p>
        ) : state.files.length === 0 ? (
          <p className="ch-empty">Working tree clean.</p>
        ) : (
          state.files.map((f) => (
            <FileRow
              key={f.path}
              file={f}
              expanded={state.expanded.includes(f.path)}
              onToggle={() => onToggleFile(f.path)}
              onOpen={onOpenFile ? () => onOpenFile(f.path) : undefined}
            />
          ))
        )}
        {state.diffTruncated && (
          <p className="ch-empty">Diff truncated — the change set exceeds the cap.</p>
        )}
      </section>
    </aside>
  );
}

function FileRow({
  file,
  expanded,
  onToggle,
  onOpen,
}: {
  file: ChangedFile;
  expanded: boolean;
  onToggle: () => void;
  onOpen?: () => void;
}): JSX.Element {
  return (
    <div className="ch-file">
      <div className="ch-file-head">
        <button type="button" className="ch-disclose" onClick={onToggle} aria-expanded={expanded}>
          {expanded ? '▾' : '▸'}
        </button>
        <button
          type="button"
          className="ch-path"
          onClick={onOpen ?? onToggle}
          title={onOpen ? `Open ${file.path}` : file.path}
        >
          {file.path}
        </button>
        <span className="ch-status">{file.status}</span>
        <span className="ch-stat add">+{file.additions}</span>
        <span className="ch-stat del">-{file.deletions}</span>
      </div>
      {expanded && (
        <div className="ch-hunks">
          {file.binary ? (
            <div className="ch-empty">Binary file — no textual diff.</div>
          ) : file.hunks.length === 0 ? (
            <div className="ch-empty">No hunks returned.</div>
          ) : (
            file.hunks.map((h) => (
              <div className="ch-hunk" key={h.header}>
                <div className="ch-hunk-head">{h.header}</div>
                {h.lines.map((l, i) => (
                  <div className={`ch-line ${l.kind}`} key={`${h.header}-${i}`}>
                    <span className="ch-no">{l.oldLine ?? ''}</span>
                    <span className="ch-no">{l.newLine ?? ''}</span>
                    <span className="ch-sign">
                      {l.kind === 'addition' ? '+' : l.kind === 'deletion' ? '-' : ' '}
                    </span>
                    <span className="ch-text">{l.text}</span>
                  </div>
                ))}
              </div>
            ))
          )}
          {file.truncated && <div className="ch-empty">File diff truncated.</div>}
        </div>
      )}
    </div>
  );
}
