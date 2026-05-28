// Skills screen — list available skills (built-in + user + project + plugin)
// + open the SKILL.md body for inspection.
// Spec: docs/VISUAL_DESIGN.html (skills tab)
// Milestone: M6-rest

import { useEffect, useState } from 'react';

interface SkillRow {
  name: string;
  description: string;
  source: 'builtin' | 'user' | 'project' | 'plugin';
  path: string;
  body?: string;
}

export function SkillsScreen(): JSX.Element {
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    // Real impl: window.deepcode.skills.list() — wired in IPC PR.
    setSkills([]);
  }, []);

  if (skills === null) {
    return <div className="p-8 text-muted">Loading skills…</div>;
  }

  const visible = skills.filter(
    (s) =>
      !filter ||
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      s.description.toLowerCase().includes(filter.toLowerCase()),
  );
  const current = skills.find((s) => s.name === active);

  return (
    <div className="flex h-full">
      <aside className="w-1/3 border-r border-border">
        <div className="border-b border-border p-3">
          <input
            type="search"
            placeholder="Filter skills…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
          />
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <li className="p-4 text-center text-muted">No skills.</li>
          ) : (
            visible.map((s) => (
              <li
                key={s.name}
                onClick={() => setActive(s.name)}
                className={
                  'cursor-pointer rounded px-3 py-2 ' +
                  (active === s.name ? 'bg-bg-elevated' : 'hover:bg-bg-elevated')
                }
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted">{s.source}</span>
                </div>
                <div className="mt-1 text-xs text-muted">{s.description}</div>
              </li>
            ))
          )}
        </ul>
      </aside>
      <main className="flex-1 overflow-y-auto p-4">
        {current ? (
          <div>
            <h2 className="font-semibold">{current.name}</h2>
            <div className="mt-1 text-xs text-muted">
              {current.source} · <code>{current.path}</code>
            </div>
            <pre className="mt-4 whitespace-pre-wrap rounded bg-bg-elevated p-3 font-mono text-xs">
              {current.body ?? '(SKILL.md body not loaded — wire IPC fetch in M6-rest.)'}
            </pre>
          </div>
        ) : (
          <div className="text-center text-muted">Select a skill to view its SKILL.md.</div>
        )}
      </main>
    </div>
  );
}
