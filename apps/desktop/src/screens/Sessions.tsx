// Sessions list screen — resume / inspect past conversations.
// Spec: docs/VISUAL_DESIGN.html screen #5
// Milestone: M6-rest

import { useEffect, useState } from 'react';

interface SessionMeta {
  id: string;
  title?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
}

interface SessionsProps {
  onPick: (sessionId: string) => void;
  onNew: () => void;
}

export function SessionsScreen({ onPick, onNew }: SessionsProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    // IPC call; fall back to empty list when main hasn't implemented yet.
    if (window.deepcode?.sessions?.list) {
      void window.deepcode.sessions
        .list()
        .then((rows) => setSessions(rows as SessionMeta[]))
        .catch(() => setSessions([]));
    } else {
      setSessions([]);
    }
  }, []);

  if (sessions === null) {
    return <div className="p-8 text-muted">Loading sessions…</div>;
  }

  const visible = sessions.filter(
    (s) =>
      !filter ||
      (s.title ?? '').toLowerCase().includes(filter.toLowerCase()) ||
      s.cwd.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-3">
        <input
          type="search"
          placeholder="Filter sessions…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
        />
        <button
          onClick={onNew}
          className="ml-2 rounded bg-accent px-4 py-2 font-medium text-bg"
        >
          + New session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-muted">
            <p>No previous sessions yet.</p>
            <p className="mt-2 text-xs">Start one with the New session button above.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((s) => (
              <li
                key={s.id}
                onClick={() => onPick(s.id)}
                className="cursor-pointer rounded border border-border p-3 hover:border-accent"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.title ?? s.id.slice(0, 8)}</span>
                  <span className="text-xs text-muted">
                    {new Date(s.updatedAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted">{s.cwd}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
