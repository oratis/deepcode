import type { SessionListEntry } from '../types/global.js';

export type SessionBucket = 'Today' | 'Yesterday' | 'Earlier' | 'Unknown date';
export const SESSION_BUCKETS: readonly SessionBucket[] = [
  'Today',
  'Yesterday',
  'Earlier',
  'Unknown date',
];

export function sessionTitle(session: Pick<SessionListEntry, 'id' | 'title'>): string {
  return session.title?.trim() || session.id;
}

/** Dates are grouped by the user's local calendar, including DST boundaries. */
export function sessionBucket(updatedAt: string, now = new Date()): SessionBucket {
  const updated = new Date(updatedAt);
  if (!Number.isFinite(updated.getTime())) return 'Unknown date';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (updated >= today) return 'Today';
  if (updated >= yesterday) return 'Yesterday';
  return 'Earlier';
}

export function sessionRelativeTime(updatedAt: string, now = new Date()): string {
  const updated = new Date(updatedAt).getTime();
  if (!Number.isFinite(updated)) return 'Unknown date';
  const seconds = Math.max(0, Math.floor((now.getTime() - updated) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function sameProject(cwd: string, projectPath: string): boolean {
  // The renderer has no filesystem authority to canonicalize paths. Do not
  // guess a project for legacy sessions whose cwd is absent.
  const normalize = (path: string): string => path.replace(/\/+$/, '') || '/';
  return Boolean(cwd && projectPath) && normalize(cwd) === normalize(projectPath);
}

/** Preserve all matches; stable ids break timestamp ties without mutating the source. */
export function selectSessions(
  sessions: readonly SessionListEntry[],
  query: string,
  projectPath?: string,
): SessionListEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions
    .filter((session) => {
      if (projectPath && !sameProject(session.cwd, projectPath)) return false;
      const text = `${sessionTitle(session)} ${session.id} ${session.cwd}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) => {
      const timestamp = (s: SessionListEntry): number => Date.parse(s.updatedAt) || 0;
      return timestamp(b) - timestamp(a) || a.id.localeCompare(b.id);
    });
}
