import { useRef, useState, type JSX } from 'react';
import { projectName } from '../lib/project.js';
import {
  SESSION_BUCKETS,
  sameProject,
  selectSessions,
  sessionBucket,
  sessionRelativeTime,
  sessionTitle,
} from '../lib/session-navigation.js';
import { sessionSetTitle } from '../lib/tauri-api.js';
import { useSessionList } from '../lib/use-session-list.js';
import { BrandMark } from './BrandMark.js';
import './navigation.css';

interface SidebarProps {
  projectPath: string;
  activeSessionId: string | null;
  onPickSession: (id: string) => void | Promise<void>;
  onNewSession: () => void;
  onSwitchProject: () => void;
  onSessionRemoved?: (id: string) => void;
  onBrowseSessions?: () => void;
  /** Prevents the composer starting a turn while session metadata is changing. */
  onMutationBusyChange?: (busy: boolean) => void;
  /** A running turn retains ownership until the host settles or interrupts it. */
  navigationLocked?: boolean;
}

export function Sidebar({
  projectPath,
  activeSessionId,
  onPickSession,
  onNewSession,
  onSwitchProject,
  onSessionRemoved,
  onBrowseSessions,
  onMutationBusyChange,
  navigationLocked = false,
}: SidebarProps): JSX.Element {
  const { sessions, loading, error, reload } = useSessionList(activeSessionId, 8_000);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [query, setQuery] = useState('');
  const [currentProjectOnly, setCurrentProjectOnly] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const actionPending = useRef(false);
  const activeSessionRef = useRef(activeSessionId);
  activeSessionRef.current = activeSessionId;
  const locked = navigationLocked || pendingId !== null;
  const visible = selectSessions(sessions, query, currentProjectOnly ? projectPath : undefined);
  const now = new Date();

  async function runAction(
    id: string,
    action: () => void | Promise<void>,
    mutation = false,
  ): Promise<void> {
    if (locked || actionPending.current) return;
    actionPending.current = true;
    setPendingId(id);
    setActionError(null);
    if (mutation) onMutationBusyChange?.(true);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      actionPending.current = false;
      setPendingId(null);
      if (mutation) onMutationBusyChange?.(false);
    }
  }

  async function commitRename(id: string): Promise<void> {
    await sessionSetTitle(id, editValue.trim());
    setEditingId(null);
    await reload();
  }

  async function removeSession(id: string, action: 'archive' | 'delete'): Promise<void> {
    await window.deepcode.sessions[action]({ id });
    if (id === activeSessionRef.current) onSessionRemoved?.(id);
    await reload();
  }

  return (
    <aside className="sidebar session-navigation" aria-label="Session navigation">
      <div className="brand-row">
        <BrandMark />
        <span className="name">DeepCode</span>
      </div>

      <div className="sb-project" title={projectPath}>
        <svg
          className="sb-project-icon"
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2.5 5.5h6l2 2h7v8.5h-15z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <span className="sb-project-name">
          <small>Project</small>
          {projectName(projectPath)}
        </span>
        <button
          type="button"
          className="sb-project-switch"
          onClick={onSwitchProject}
          disabled={locked}
          aria-label="Switch project folder"
          title="Switch to another folder"
        >
          ⇄
        </button>
      </div>

      <button type="button" className="new-btn" onClick={onNewSession} disabled={locked}>
        <span>+ New session</span>
        <kbd>⌘N</kbd>
      </button>

      <div className="sb-list-heading">
        <span>
          Sessions <span className="sb-count">{sessions.length}</span>
        </span>
        {onBrowseSessions && (
          <button type="button" onClick={onBrowseSessions}>
            All sessions ↗
          </button>
        )}
      </div>

      <div className="sb-search">
        <span className="sb-search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          type="search"
          aria-label="Search sessions"
          placeholder="Search sessions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
          }}
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className="sb-search-clear"
            onClick={() => setQuery('')}
            aria-label="Clear session search"
          >
            ×
          </button>
        )}
      </div>
      <label className="sb-project-filter">
        <input
          type="checkbox"
          checked={currentProjectOnly}
          onChange={(e) => setCurrentProjectOnly(e.target.checked)}
        />
        This project only
      </label>

      {navigationLocked && (
        <p className="sb-notice" role="status">
          Finish or stop the running turn to switch sessions.
        </p>
      )}
      {(error || actionError) && (
        <div className="navigation-error" role="alert">
          <strong>{actionError ? 'Session action failed' : 'Could not refresh sessions'}</strong>
          <span>{actionError || error}</span>
          {error && (
            <button type="button" onClick={() => void reload()}>
              Retry loading
            </button>
          )}
          {actionError && (
            <button type="button" onClick={() => setActionError(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}

      <nav className="sb-session-list" aria-label="Sessions" aria-busy={loading}>
        {loading && (
          <p className="sb-empty" role="status">
            Loading sessions…
          </p>
        )}
        {!loading && visible.length === 0 && !error && (
          <div className="sb-empty" role="status">
            <strong>
              {query.trim()
                ? 'No matching sessions'
                : currentProjectOnly
                  ? 'No sessions for this project'
                  : 'Start your first session'}
            </strong>
            <span>
              {query.trim()
                ? 'Try a title, session ID or project path.'
                : currentProjectOnly
                  ? 'Clear the project filter to include older sessions without a project.'
                  : 'Ask DeepCode to explore, plan or make a change.'}
            </span>
          </div>
        )}
        {SESSION_BUCKETS.map((bucket) => {
          const rows = visible.filter(
            (session) => sessionBucket(session.updatedAt, now) === bucket,
          );
          if (!rows.length) return null;
          return (
            <section key={bucket} aria-label={bucket}>
              <h2 className="section-title">
                {bucket}
                <span>{rows.length}</span>
              </h2>
              {rows.map((session) => {
                const label = sessionTitle(session);
                return (
                  <div
                    key={session.id}
                    className={'item' + (session.id === activeSessionId ? ' active' : '')}
                  >
                    {editingId === session.id ? (
                      <form
                        className="sb-rename"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void runAction(session.id, () => commitRename(session.id), true);
                        }}
                      >
                        <input
                          autoFocus
                          aria-label="Session title"
                          value={editValue}
                          placeholder="Session name…"
                          disabled={locked}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <div>
                          <button type="submit" disabled={locked}>
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="sb-session-main"
                          aria-current={session.id === activeSessionId ? 'page' : undefined}
                          disabled={locked}
                          onClick={() =>
                            void runAction(session.id, () => onPickSession(session.id))
                          }
                          title={`${label} · ${session.id}${session.cwd ? ` · ${session.cwd}` : ''}`}
                        >
                          <span className="dot" aria-hidden="true" />
                          <span className="sb-session-copy">
                            <span className="label">{label}</span>
                            {session.cwd && !sameProject(session.cwd, projectPath) && (
                              <small>{projectName(session.cwd)}</small>
                            )}
                          </span>
                          <span className="meta">
                            {pendingId === session.id
                              ? '…'
                              : sessionRelativeTime(session.updatedAt, now)}
                          </span>
                        </button>
                        <span className="row-actions">
                          <button
                            type="button"
                            className="row-act"
                            disabled={locked}
                            aria-label={`Rename session ${label}`}
                            title="Rename session"
                            onClick={() => {
                              setEditingId(session.id);
                              setEditValue(session.title?.trim() || '');
                            }}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="row-act"
                            disabled={locked}
                            aria-label={`Archive session ${label}`}
                            title="Archive session"
                            onClick={() =>
                              void runAction(
                                session.id,
                                () => removeSession(session.id, 'archive'),
                                true,
                              )
                            }
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="row-act danger"
                            disabled={locked}
                            aria-label={`Delete session ${label}`}
                            title="Delete session"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete session "${label}"? This permanently removes its history.`,
                                )
                              )
                                void runAction(
                                  session.id,
                                  () => removeSession(session.id, 'delete'),
                                  true,
                                );
                            }}
                          >
                            ×
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
