// Sessions list — design-aligned. Browse + filter + resume past
// conversations. Per spec screen #5.

import { useEffect, useState } from 'react';
import { Card, Screen } from '../components/Screen.js';
import { listSessions, type SessionMeta } from '../lib/tauri-api.js';

interface SessionsProps {
  onPick: (sessionId: string) => void;
  onNew: () => void;
}

export function SessionsScreen({ onPick, onNew }: SessionsProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    void listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  if (sessions === null) {
    return (
      <Screen title="Sessions">
        <div style={{ padding: 20, color: 'var(--text-2)' }}>Loading…</div>
      </Screen>
    );
  }

  const filtered = sessions.filter((s) =>
    !filter || s.id.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Screen
      title="Sessions"
      subtitle={`${sessions.length} total`}
      actions={
        <button type="button" className="btn btn-primary" onClick={onNew}>
          + New
        </button>
      }
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <input
          type="search"
          className="input"
          placeholder="Filter by id…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ marginBottom: 14, fontFamily: 'inherit' }}
        />

        <Card flush padding={0}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--text-3)',
                fontSize: 13,
              }}
            >
              {sessions.length === 0
                ? 'No sessions yet — your conversations are saved automatically.'
                : 'No matches for that filter.'}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {filtered.map((s, i) => (
                <li
                  key={s.id}
                  onClick={() => onPick(s.id)}
                  style={{
                    padding: '12px 16px',
                    borderBottom:
                      i === filtered.length - 1
                        ? 'none'
                        : '1px solid var(--line-soft)',
                    cursor: 'pointer',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 12,
                    alignItems: 'baseline',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--bg-3)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text-0)',
                        fontWeight: 500,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      {s.id}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-3)',
                        marginTop: 2,
                      }}
                    >
                      {(s.size_bytes / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                    {relativeTime(s.updated_at_secs)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p
          style={{
            fontSize: 11,
            color: 'var(--text-3)',
            textAlign: 'center',
            marginTop: 16,
          }}
        >
          Sessions are stored as JSONL under ~/.deepcode/sessions/. Resume to
          continue any previous conversation.
        </p>
      </div>
    </Screen>
  );
}

function relativeTime(secs: number): string {
  const diff = Math.floor(Date.now() / 1000) - secs;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
