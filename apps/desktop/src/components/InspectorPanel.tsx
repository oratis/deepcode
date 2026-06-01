// Right-column expanded inspector (320 px).
// Design spec screen #3 — the panel that the 48 px rail expands into when the
// user clicks ‹ or presses ⌘\. Four sections, top to bottom:
//   ▤ Plan          — the agent's TodoWrite list, with a pending count
//   ◐ Context        — token usage, same bar as the composer's .ctx-bar
//   📁 Recent files  — files touched by Write/Edit this conversation
//   ⓘ Session info   — project / path / model / mode / cost
//
// All data comes from the InspectorData the parent (App) maintains; this
// component is purely presentational. Sections with no data show an honest
// empty state rather than a placeholder — per HANDOFF: no fake sections.

import { useEffect, useRef } from 'react';
import { contextWindowFor } from '@deepcode/core/dist/providers/deepseek.js';
import { projectName } from '../lib/project.js';
import type { InspectorData, InspectorSection } from '../types/inspector.js';

interface InspectorPanelProps {
  projectPath: string;
  data: InspectorData;
  /** Collapse back to the 48 px rail (the › button / ⌘\). */
  onCollapse: () => void;
  /**
   * Section to scroll into view when the panel opens — set when the user
   * clicked one of the rail's hint icons (▤/◐/📁/ⓘ) rather than the chevron.
   */
  focusSection?: InspectorSection | null;
  /** Open a recent file in the right-side file panel (§3.11). */
  onOpenFile?: (path: string) => void;
}

const MODE_LABELS: Record<string, string> = {
  default: 'Default · ask',
  acceptEdits: 'Accept edits',
  plan: 'Plan mode',
  dontAsk: "Don't ask",
  bypassPermissions: 'Bypass',
};

export function InspectorPanel({
  projectPath,
  data,
  onCollapse,
  focusSection,
  onOpenFile,
}: InspectorPanelProps): JSX.Element {
  const { usage, costYuan, model, mode, recentFiles, todos } = data;

  const contextWindow = contextWindowFor(model);
  const usedTokens = usage.inputTokens + usage.outputTokens;
  const fillPct = Math.min(100, (usedTokens / contextWindow) * 100);

  const pending = todos.filter((t) => t.status !== 'completed').length;

  // Scroll the requested section to the top when the panel opens via a rail
  // hint icon. The header is sticky so the heading lands just below it.
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusSection) return;
    const el = rootRef.current?.querySelector(`[data-section="${focusSection}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focusSection]);

  return (
    <aside className="inspector" ref={rootRef}>
      <div className="inspector-head">
        <span className="inspector-title">Inspector</span>
        <button
          type="button"
          className="rail-btn"
          title="Collapse inspector (⌘\\)"
          onClick={onCollapse}
        >
          ›
        </button>
      </div>

      {/* ── ▤ Plan ─────────────────────────────────────────────── */}
      <h5 data-section="plan">▤ Plan{pending > 0 ? ` · ${pending} pending` : ''}</h5>
      {todos.length === 0 ? (
        <p className="insp-empty">No plan yet — the agent hasn’t written a todo list.</p>
      ) : (
        <div className="todo-list">
          {todos.map((t, i) => (
            <div
              key={i}
              className={
                'todo-item' +
                (t.status === 'completed' ? ' done' : t.status === 'in_progress' ? ' active' : '')
              }
            >
              <span className="check" />
              <span className="label">{t.status === 'in_progress' ? t.activeForm : t.content}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── ◐ Context ──────────────────────────────────────────── */}
      <h5 data-section="context">◐ Context</h5>
      <div className="ctx-bar">
        <span>
          {usedTokens.toLocaleString()} / {contextWindow.toLocaleString()}
        </span>
        <div className="progress">
          <div className="fill" style={{ width: `${fillPct}%` }} />
        </div>
        <span>{fillPct.toFixed(1)}%</span>
      </div>

      {/* ── 📁 Recent files ────────────────────────────────────── */}
      <h5 data-section="files">📁 Recent files</h5>
      {recentFiles.length === 0 ? (
        <p className="insp-empty">No files written or edited yet.</p>
      ) : (
        <div className="recent-files">
          {recentFiles.map((f) => (
            <div
              className="recent-file"
              key={f}
              title={onOpenFile ? `Open ${f}` : f}
              role={onOpenFile ? 'button' : undefined}
              tabIndex={onOpenFile ? 0 : undefined}
              onClick={onOpenFile ? () => onOpenFile(f) : undefined}
              style={onOpenFile ? { cursor: 'pointer' } : undefined}
            >
              <span className="name">{basename(f)}</span>
              <span className="dir">{dirname(f)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── ⓘ Session info ─────────────────────────────────────── */}
      <h5 data-section="session">ⓘ Session info</h5>
      <div className="insp-row">
        <span className="k">Project</span>
        <span className="v">{projectName(projectPath)}</span>
      </div>
      <div className="insp-row">
        <span className="k">Path</span>
        <span className="v" title={projectPath}>
          {abbreviatePath(projectPath)}
        </span>
      </div>
      <div className="insp-row">
        <span className="k">Model</span>
        <span className="v">{model}</span>
      </div>
      <div className="insp-row">
        <span className="k">Mode</span>
        <span className="v">{MODE_LABELS[mode] ?? mode}</span>
      </div>
      <div className="insp-row">
        <span className="k">Spend</span>
        <span className="v">¥ {costYuan.toFixed(4)}</span>
      </div>
    </aside>
  );
}

// ─── path helpers ─────────────────────────────────────────────────────

function basename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function dirname(p: string): string {
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '';
  return abbreviatePath(p.slice(0, idx));
}

/** Abbreviate a long path by replacing the $HOME prefix with "~". */
function abbreviatePath(p: string): string {
  const m = p.match(/^\/Users\/[^/]+/);
  if (m) return '~' + p.slice(m[0].length);
  return p;
}
