// Skills screen — design-aligned.
// List available skills (built-in + user + project + plugin) + show the
// SKILL.md body for inspection. Per spec screen #11.

import { useEffect, useState } from 'react';
import { Badge, type BadgeKind } from '../components/Badge.js';
import { Card, Screen } from '../components/Screen.js';

interface SkillRow {
  name: string;
  description: string;
  source: 'builtin' | 'user' | 'project' | 'plugin';
  path: string;
  body?: string;
}

const SOURCE_BADGE: Record<SkillRow['source'], { kind: BadgeKind; label: string }> = {
  builtin: { kind: 'info', label: 'built-in' },
  user: { kind: 'warn', label: 'user' },
  project: { kind: 'ok', label: 'project' },
  plugin: { kind: 'info', label: 'plugin' },
};

export function SkillsScreen(): JSX.Element {
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (window.deepcode?.skills?.list) {
      void window.deepcode.skills
        .list()
        .then((rows) => setSkills(rows as SkillRow[]))
        .catch(() => setSkills([]));
    } else {
      setSkills([]);
    }
  }, []);

  if (skills === null) {
    return (
      <Screen title="Skills">
        <div style={{ padding: 20, color: 'var(--text-2)' }}>Loading…</div>
      </Screen>
    );
  }

  const filtered = skills.filter(
    (s) =>
      !filter ||
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.description.toLowerCase().includes(filter.toLowerCase()),
  );
  const current = skills.find((s) => s.name === active);

  return (
    <Screen title="Skills" subtitle={`${skills.length} total`}>
      <div
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 1fr) 2fr',
          gap: 14,
          alignItems: 'start',
        }}
      >
        {/* Left: filter + list */}
        <div>
          <input
            type="search"
            className="input"
            placeholder="Filter skills…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 12, fontFamily: 'inherit' }}
          />

          <Card flush padding={0}>
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  color: 'var(--text-3)',
                  fontSize: 13,
                }}
              >
                {skills.length === 0 ? 'No skills available.' : 'No matches.'}
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {filtered.map((s, i) => {
                  const badge = SOURCE_BADGE[s.source];
                  return (
                    <li
                      key={s.name}
                      onClick={() => setActive(s.name)}
                      style={{
                        padding: '10px 14px',
                        borderBottom:
                          i === filtered.length - 1
                            ? 'none'
                            : '1px solid var(--line-soft)',
                        cursor: 'pointer',
                        background:
                          s.name === active ? 'var(--brand-tint)' : 'transparent',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: s.name === active ? '#b4c2ff' : 'var(--text-0)',
                          }}
                        >
                          {s.name}
                        </span>
                        <Badge kind={badge.kind}>{badge.label}</Badge>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
                        {s.description}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* Right: detail */}
        <div>
          {current ? (
            <Card
              title={current.name}
              actions={
                <Badge kind={SOURCE_BADGE[current.source].kind}>
                  {SOURCE_BADGE[current.source].label}
                </Badge>
              }
            >
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-3)',
                  marginBottom: 10,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {current.path}
              </div>
              <pre
                style={{
                  background: 'var(--bg-0)',
                  color: 'var(--text-1)',
                  border: '1px solid var(--line-soft)',
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  margin: 0,
                  maxHeight: 480,
                  overflowY: 'auto',
                  lineHeight: 1.5,
                }}
              >
                {current.body ?? '(SKILL.md body not loaded — the desktop IPC for fetching skill body lands in v0.2.)'}
              </pre>
            </Card>
          ) : (
            <Card>
              <div
                style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: 'var(--text-2)',
                  fontSize: 13,
                }}
              >
                Pick a skill from the list to view its SKILL.md.
              </div>
            </Card>
          )}
        </div>
      </div>
    </Screen>
  );
}
