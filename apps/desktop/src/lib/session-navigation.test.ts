import { describe, expect, it } from 'vitest';
import type { SessionListEntry } from '../types/global.js';
import {
  sameProject,
  selectSessions,
  sessionBucket,
  sessionRelativeTime,
  sessionTitle,
} from './session-navigation.js';

const row = (id: string, overrides: Partial<SessionListEntry> = {}): SessionListEntry => ({
  id,
  title: `Session ${id}`,
  cwd: '/work/deepcode',
  updatedAt: '2026-11-17T09:00:00Z',
  ...overrides,
});

describe('session navigation', () => {
  it('groups by calendar dates rather than rolling 24-hour windows', () => {
    const now = new Date(2026, 10, 17, 0, 5);
    expect(sessionBucket(new Date(2026, 10, 17, 0, 1).toISOString(), now)).toBe('Today');
    expect(sessionBucket(new Date(2026, 10, 16, 23, 58).toISOString(), now)).toBe('Yesterday');
    expect(sessionBucket(new Date(2026, 10, 15, 23, 59).toISOString(), now)).toBe('Earlier');
    expect(sessionBucket('invalid', now)).toBe('Unknown date');
  });

  it('never displays a negative age for clock skew or an invalid date as recent', () => {
    const now = new Date('2026-11-17T09:00:00Z');
    expect(sessionRelativeTime('2026-11-17T09:10:00Z', now)).toBe('now');
    expect(sessionRelativeTime('2026-11-17T08:00:00Z', now)).toBe('1h ago');
    expect(sessionRelativeTime('invalid', now)).toBe('Unknown date');
  });

  it('searches title, id and project with all query words and keeps every result', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`thread-${i}`, { title: 'Fix auth' }));
    expect(selectSessions(rows, ' AUTH deepcode ')).toHaveLength(30);
    expect(selectSessions(rows, 'thread-29')).toEqual([rows[29]]);
    expect(selectSessions(rows, 'auth missing')).toEqual([]);
  });

  it('sorts recent sessions deterministically without modifying the host result', () => {
    const rows = [
      row('z'),
      row('invalid', { updatedAt: 'invalid' }),
      row('newest', { updatedAt: '2026-11-18T09:00:00Z' }),
      row('a'),
    ];
    expect(selectSessions(rows, '').map((s) => s.id)).toEqual(['newest', 'a', 'z', 'invalid']);
    expect(rows.map((s) => s.id)).toEqual(['z', 'invalid', 'newest', 'a']);
  });

  it('requires known exact project identity while retaining legacy rows in all projects', () => {
    const rows = [row('current'), row('legacy', { cwd: '' }), row('other', { cwd: '/work/other' })];
    expect(selectSessions(rows, '', '/work/deepcode/').map((s) => s.id)).toEqual(['current']);
    expect(selectSessions(rows, '')).toHaveLength(3);
    expect(sameProject('/work/deepcode-copy', '/work/deepcode')).toBe(false);
    expect(sameProject('', '/work/deepcode')).toBe(false);
    expect(sameProject('/', '/')).toBe(true);
  });

  it('uses the stable id when a title is empty', () => {
    expect(sessionTitle(row('thread-1', { title: '  ' }))).toBe('thread-1');
    expect(sessionTitle(row('thread-1', { title: '  Fix auth  ' }))).toBe('Fix auth');
  });
});
