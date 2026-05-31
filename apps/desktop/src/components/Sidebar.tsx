// Left-column sessions sidebar — design spec screen #3.
//
// Above the session list: a "project" chip showing the currently active
// folder + a small switch-folder button. Below: sessions bucketed by
// Today/Yesterday/Earlier per the spec note ①.

import { useEffect, useState } from 'react';
import { projectName } from '../lib/project.js';
import { listSessions, type SessionMeta } from '../lib/tauri-api.js';
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
}: SidebarProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [now, setNow] = useState<number>(Math.floor(Date.now() / 1000));

  useEffect(() => {
    void listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

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
                onClick={() => onPickSession(s.id)}
                title={`${s.title} · ${s.id}`}
              >
                <span className="dot" />
                <span className="label">{s.title?.trim() ? s.title : shortTitle(s.id)}</span>
                <span className="meta">{relTime(s.updated_at_secs, now)}</span>
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
