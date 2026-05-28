// Settings screen — inspect + edit ~/.deepcode/settings.json
// Spec: docs/VISUAL_DESIGN.html screen #6
// Milestone: M6-rest

import { useEffect, useState } from 'react';

export function SettingsScreen(): JSX.Element {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void window.deepcode.settings.load().then((s) => setSettings(s));
  }, []);

  if (settings === null) {
    return <div className="p-8 text-muted">Loading settings…</div>;
  }

  // Flat-key view: convert nested settings to dot.notation entries for display
  const flat: Array<{ key: string; value: string }> = [];
  function walk(prefix: string, obj: unknown): void {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        walk(prefix ? `${prefix}.${k}` : k, v);
      }
    } else {
      flat.push({ key: prefix, value: JSON.stringify(obj) });
    }
  }
  walk('', settings);

  const visible = flat.filter(
    (e) =>
      !search ||
      e.key.toLowerCase().includes(search.toLowerCase()) ||
      e.value.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <input
          type="search"
          placeholder="Filter settings…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-muted">
            <p>No matching settings.</p>
            <p className="mt-2 text-xs">
              Default config: ~/.deepcode/settings.json · project: .deepcode/settings.json
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="p-2 text-left">Key</th>
                <th className="p-2 text-left">Value</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.key} className="border-t border-border">
                  <td className="p-2 font-mono">{e.key}</td>
                  <td className="p-2 font-mono text-muted">{e.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="border-t border-border p-3 text-xs text-muted">
        Edit by opening ~/.deepcode/settings.json in your editor (visual editor lands in M7).
      </div>
    </div>
  );
}
