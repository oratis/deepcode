// Permissions screen — view + edit settings.permissions rules.
// Spec: docs/VISUAL_DESIGN.html (permissions tab) · M3 permission rules
// Milestone: M6-rest

import { useEffect, useState } from 'react';

type RuleType = 'allow' | 'ask' | 'deny';

interface PermissionsView {
  defaultMode: string;
  allow: string[];
  ask: string[];
  deny: string[];
  additionalDirectories: string[];
}

export function PermissionsScreen(): JSX.Element {
  const [perm, setPerm] = useState<PermissionsView | null>(null);
  const [newRule, setNewRule] = useState({ type: 'allow' as RuleType, pattern: '' });

  useEffect(() => {
    void window.deepcode.settings.load().then((settings) => {
      const p = (settings.permissions as PermissionsView | undefined) ?? {
        defaultMode: 'default',
        allow: [],
        ask: [],
        deny: [],
        additionalDirectories: [],
      };
      setPerm({
        defaultMode: p.defaultMode ?? 'default',
        allow: p.allow ?? [],
        ask: p.ask ?? [],
        deny: p.deny ?? [],
        additionalDirectories: p.additionalDirectories ?? [],
      });
    });
  }, []);

  if (perm === null) return <div className="p-8 text-muted">Loading permissions…</div>;

  function addRule(): void {
    if (!newRule.pattern.trim()) return;
    setPerm((p) =>
      p ? { ...p, [newRule.type]: [...p[newRule.type], newRule.pattern.trim()] } : p,
    );
    setNewRule({ type: 'allow', pattern: '' });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border p-3">
        <h2 className="font-semibold">Permissions</h2>
        <p className="mt-1 text-xs text-muted">
          Default mode: <code>{perm.defaultMode}</code>. Precedence: deny &gt; ask &gt; allow.
        </p>
      </header>

      <div className="border-b border-border p-3">
        <div className="flex gap-2">
          <select
            value={newRule.type}
            onChange={(e) => setNewRule({ ...newRule, type: e.target.value as RuleType })}
            className="rounded border border-border bg-bg px-3 py-2"
          >
            <option value="allow">allow</option>
            <option value="ask">ask</option>
            <option value="deny">deny</option>
          </select>
          <input
            value={newRule.pattern}
            onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
            placeholder='e.g. Bash(npm test:*) or Read(./src/**)'
            className="flex-1 rounded border border-border bg-bg px-3 py-2 outline-none focus:border-accent"
          />
          <button
            onClick={addRule}
            disabled={!newRule.pattern.trim()}
            className="rounded bg-accent px-4 py-2 font-medium text-bg disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          Save isn't wired yet — view-only preview for M6-rest.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {(['deny', 'ask', 'allow'] as const).map((kind) => (
          <section key={kind} className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-muted">
              {kind.toUpperCase()} · {perm[kind].length}
            </h3>
            {perm[kind].length === 0 ? (
              <div className="text-xs text-muted">(none)</div>
            ) : (
              <ul className="space-y-1">
                {perm[kind].map((p, i) => (
                  <li key={i} className="rounded bg-bg-elevated px-3 py-1 font-mono text-xs">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
        {perm.additionalDirectories.length > 0 && (
          <section className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-muted">
              Additional Directories
            </h3>
            <ul className="space-y-1">
              {perm.additionalDirectories.map((d, i) => (
                <li key={i} className="rounded bg-bg-elevated px-3 py-1 font-mono text-xs">
                  {d}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
