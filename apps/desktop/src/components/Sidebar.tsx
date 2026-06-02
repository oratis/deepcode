// Left-column sessions sidebar — design spec screen #3.
//
// Above the session list: a "project" chip showing the currently active
// folder + a small switch-folder button. Below: sessions bucketed by
// Today/Yesterday/Earlier per the spec note ①.

import { useCallback, useEffect, useState } from 'react';
import { projectName } from '../lib/project.js';
import {
  listSessions,
  sessionArchive,
  sessionDelete,
  sessionSetTitle,
  type SessionMeta,
} from '../lib/tauri-api.js';
import { BrandMark } from './BrandMark.js';

interface SidebarProps {
  /** Absolute path of the active project folder. */
  projectPath: string;
  /** Currently active session id; null when on transient/global screens. */
  activeSessionId: string | null;
  onPickSession: (id: string) => void;
  onNewSession: () => void;
  /** Triggers a re-show of the folder picker so the user can switch projects. */
  onSwitchProject: () => void;
  /** Called after the active session is archived/deleted so the parent resets. */
  onSessionRemoved?: (id: string) => void;
}

type Bucket = 'Today' | 'Yesterday' | 'Earlier';

function bucketFor(updatedAtSecs: number, nowSecs: number): Bucket {
  const diffSec = nowSecs - updatedAtSecs;
  if (diffSec < 60 * 60 * 24) return 'Today';
  if (diffSec < 60 * 60 * 48) return 'Yesterday';
  return 'Earlier';
}

function relTime(updatedAtSecs: number, nowSecs: number): string {
  const diffSec = nowSecs - updatedAtSecs;
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return '·';
}

export function Sidebar({
  projectPath,
  activeSessionId,
  onPickSession,
  onNewSession,
  onSwitchProject,
  onSessionRemoved,
}: SidebarProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [now, setNow] = useState<number>(Math.floor(Date.now() / 1000));
  // Inline rename: which session is being edited + its draft title.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const reload = useCallback(() => {
    void listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  // Reload on mount + whenever the active session changes, then poll so a
  // session's auto-derived title (set on its first message) and freshly-created
  // sessions surface without needing a remount.
  useEffect(() => {
    reload();
  }, [reload, activeSessionId]);
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
      reload();
    }, 8_000);
    return () => clearInterval(t);
  }, [reload]);

  async function commitRename(id: string): Promise<void> {
    setEditingId(null);
    try {
      await sessionSetTitle(id, editValue.trim());
      reload();
    } catch {
      /* keep the old title on failure */
    }
  }

  async function handleArchive(id: string): Promise<void> {
    try {
      await sessionArchive(id);
      if (id === activeSessionId) onSessionRemoved?.(id);
      reload();
    } catch {
      /* ignore — session stays listed */
    }
  }

  async function handleDelete(id: string, label: string): Promise<void> {
    if (!window.confirm(`Delete session "${label}"? This permanently removes its history.`)) {
      return;
    }
    try {
      await sessionDelete(id);
      if (id === activeSessionId) onSessionRemoved?.(id);
      reload();
    } catch {
      /* ignore — session stays listed */
    }
  }

  const grouped: Record<Bucket, SessionMeta[]> = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  };
  for (const s of sessions) {
    grouped[bucketFor(s.updated_at_secs, now)].push(s);
  }

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <BrandMark />
        <span className="name">DeepCode</span>
      </div>

      {/* Active project chip */}
      <div
        style={{
          margin: '4px 4px 12px',
          padding: '8px 10px',
          background: 'var(--bg-1)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 11,
          color: 'var(--text-2)',
        }}
        title={projectPath}
      >
        <div
          style={{
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: 'var(--text-3)',
            marginBottom: 3,
          }}
        >
          Project
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--text-0)',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <span>📁</span>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {projectName(projectPath)}
          </span>
          <button
            type="button"
            onClick={onSwitchProject}
            title="Switch to another folder"
            style={{
              background: 'transparent',
              border: 0,
              color: 'var(--text-3)',
              cursor: 'pointer',
              fontSize: 11,
              padding: 2,
            }}
          >
            ⇄
          </button>
        </div>
      </div>

      <button type="button" className="new-btn" onClick={onNewSession}>
        <span>+ New session</span>
        <kbd>⌘N</kbd>
      </button>

      {(['Today', 'Yesterday', 'Earlier'] as const).map((bucket) => {
        const items = grouped[bucket];
        if (items.length === 0) return null;
        return (
          <div key={bucket}>
            <div className="section-title">{bucket}</div>
            {items.slice(0, 20).map((s) => (
              <div
                key={s.id}
                className={'item' + (s.id === activeSessionId ? ' active' : '')}
                onClick={() => editingId !== s.id && onPickSession(s.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(s.id);
                  setEditValue(s.title?.trim() ? s.title : '');
                }}
                title={`${s.title} · ${s.id}  (double-click to rename)`}
              >
                <span className="dot" />
                {editingId === s.id ? (
                  <input
                    className="label"
                    autoFocus
                    value={editValue}
                    placeholder="Session name…"
                    onChange={(e) => setEditValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(s.id);
                      else if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => void commitRename(s.id)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: 'transparent',
                      border: '1px solid var(--line)',
                      borderRadius: 4,
                      color: 'var(--text-0)',
                      font: 'inherit',
                      padding: '0 4px',
                    }}
                  />
                ) : (
                  <span className="label">{s.title?.trim() ? s.title : shortTitle(s.id)}</span>
                )}
                <span className="meta">{relTime(s.updated_at_secs, now)}</span>
                {editingId !== s.id && (
                  <span className="row-actions">
                    <button
                      type="button"
                      className="row-act"
                      title="Archive session"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleArchive(s.id);
                      }}
                    >
                      🗄
                    </button>
                    <button
                      type="button"
                      className="row-act danger"
                      title="Delete session"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(s.id, s.title?.trim() ? s.title : shortTitle(s.id));
                      }}
                    >
                      🗑
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {sessions.length === 0 && (
        <div
          style={{
            marginTop: 12,
            padding: '8px 8px',
            color: 'var(--text-3)',
            fontSize: 11,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          No sessions yet — your conversations will appear here once you start one.
        </div>
      )}
    </aside>
  );
}

/** Session ids look like `2026-05-28-abc123` — strip the date for display. */
function shortTitle(id: string): string {
  const m = id.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return m ? m[1]! : id;
}
