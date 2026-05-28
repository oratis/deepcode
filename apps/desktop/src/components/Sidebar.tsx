// Left-column sessions sidebar — design spec screen #3.
//
// Sections: "Today / Yesterday / Earlier" bucketed by updatedAt; each
// row shows a dot + label + relative-time meta. Active row gets the
// brand-tinted background + 1 px brand-line border (no flat color block
// per the spec note ①).

import { useEffect, useState } from 'react';
import { listSessions, type SessionMeta } from '../lib/tauri-api.js';
import { BrandMark } from './BrandMark.js';

interface SidebarProps {
  /** Currently active session id; null when on transient/global screens. */
  activeSessionId: string | null;
  onPickSession: (id: string) => void;
  onNewSession: () => void;
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
  activeSessionId,
  onPickSession,
  onNewSession,
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

  // Group sessions by bucket, preserving order
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
                title={s.id}
              >
                <span className="dot" />
                <span className="label">{shortTitle(s.id)}</span>
                <span className="meta">{relTime(s.updated_at_secs, now)}</span>
              </div>
            ))}
          </div>
        );
      })}

      {sessions.length === 0 && (
        <div
          style={{
            marginTop: 16,
            padding: '12px 8px',
            color: 'var(--text-3)',
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          No sessions yet — talk to DeepCode to start one.
        </div>
      )}
    </aside>
  );
}

/** Session ids are `2026-05-28-abc123` — strip the date for display. */
function shortTitle(id: string): string {
  const m = id.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return m ? m[1]! : id;
}
