import { useState, type JSX } from 'react';
import { Card, Screen } from '../components/Screen.js';
import { projectName } from '../lib/project.js';
import { selectSessions, sessionRelativeTime, sessionTitle } from '../lib/session-navigation.js';
import { useSessionList } from '../lib/use-session-list.js';
import '../components/navigation.css';

interface SessionsProps {
  onPick: (sessionId: string) => void | Promise<void>;
  onNew: () => void;
  projectPath?: string;
  activeSessionId?: string | null;
  navigationLocked?: boolean;
}

export function SessionsScreen({
  onPick,
  onNew,
  projectPath,
  activeSessionId,
  navigationLocked = false,
}: SessionsProps): JSX.Element {
  const { sessions, loading, error, reload } = useSessionList(activeSessionId);
  const [filter, setFilter] = useState('');
  const [currentProjectOnly, setCurrentProjectOnly] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const filtered = selectSessions(sessions, filter, currentProjectOnly ? projectPath : undefined);
  const locked = navigationLocked || openingId !== null;

  async function open(id: string): Promise<void> {
    if (locked) return;
    setOpeningId(id);
    setOpenError(null);
    try {
      await onPick(id);
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <Screen
      title="Sessions"
      subtitle="Continue where you left off"
      actions={
        <button type="button" className="btn btn-primary" onClick={onNew} disabled={locked}>
          + New session
        </button>
      }
    >
      <div className="session-browser">
        <div className="session-browser-toolbar">
          <input
            type="search"
            className="input"
            aria-label="Find a session"
            placeholder="Search title, ID or project…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilter('');
            }}
          />
          <button type="button" className="btn" onClick={() => void reload()}>
            Refresh
          </button>
        </div>
        <div className="session-browser-summary">
          <span role="status">
            {loading ? 'Loading sessions…' : `${filtered.length} of ${sessions.length} sessions`}
          </span>
          {projectPath && (
            <label>
              <input
                type="checkbox"
                checked={currentProjectOnly}
                onChange={(e) => setCurrentProjectOnly(e.target.checked)}
              />
              This project only
            </label>
          )}
        </div>
        {navigationLocked && (
          <p className="sb-notice" role="status">
            Finish or stop the running turn before opening another session.
          </p>
        )}
        {(error || openError) && (
          <div className="navigation-error" role="alert">
            <strong>{openError ? 'Could not open session' : 'Could not load sessions'}</strong>
            <span>{openError || error}</span>
            {error && (
              <button type="button" onClick={() => void reload()}>
                Retry loading
              </button>
            )}
          </div>
        )}

        <Card flush padding={0}>
          {!loading && filtered.length === 0 && !error ? (
            <div className="session-browser-empty">
              <strong>
                {filter.trim()
                  ? 'No matching sessions'
                  : currentProjectOnly
                    ? 'No sessions for this project'
                    : 'Your next idea starts here'}
              </strong>
              <p>
                {filter.trim()
                  ? 'Search by a title, session ID or project path.'
                  : currentProjectOnly
                    ? 'Clear the project filter to find older sessions without project information.'
                    : 'Start a session to explore your project or make a change. Saved conversations appear here.'}
              </p>
              {filter || currentProjectOnly ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setFilter('');
                    setCurrentProjectOnly(false);
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={onNew} disabled={locked}>
                  New session
                </button>
              )}
            </div>
          ) : (
            <ul className="session-browser-list" aria-label="Saved sessions" aria-busy={loading}>
              {filtered.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className="session-browser-row"
                    aria-current={session.id === activeSessionId ? 'page' : undefined}
                    disabled={locked}
                    onClick={() => void open(session.id)}
                  >
                    <span className="session-browser-copy">
                      <strong>{sessionTitle(session)}</strong>
                      <span title={session.cwd || undefined}>
                        {session.cwd ? projectName(session.cwd) : 'Project not recorded'}
                        <span aria-hidden="true"> · </span>
                        <span className="session-browser-id">{session.id}</span>
                      </span>
                    </span>
                    <span className="session-browser-age">
                      {openingId === session.id
                        ? 'Opening…'
                        : session.id === activeSessionId
                          ? 'Current session'
                          : sessionRelativeTime(session.updatedAt)}
                      <span aria-hidden="true"> ↗</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="session-browser-hint">
          Open a saved session to read its history and continue the conversation.
        </p>
      </div>
    </Screen>
  );
}
