// Plugins screen — list installed plugins, view trust state + contributed
// hooks, enable/disable, install new ones.
// Spec: docs/VISUAL_DESIGN.html screen #9
// Milestone: M6-rest

import { useEffect, useState } from 'react';

interface PluginRow {
  name: string;
  version: string;
  enabled: boolean;
  contributedHookEvents: string[];
  sourceHash: string;
  trustedBy: 'user' | 'marketplace' | 'official';
  warning?: string;
}

export function PluginsScreen(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginRow[] | null>(null);
  const [installSpec, setInstallSpec] = useState('');
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Real impl: window.deepcode.plugins.list() — wired in IPC PR.
    setPlugins([]);
  }, []);

  async function handleInstall(): Promise<void> {
    if (!installSpec.trim()) return;
    setInstalling(true);
    try {
      // window.deepcode.plugins.install(installSpec) — TODO wire in IPC PR
      // For now no-op.
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      setInstalling(false);
      setInstallSpec('');
    }
  }

  if (plugins === null) {
    return <div className="p-8 text-muted">Loading plugins…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border p-3">
        <h2 className="font-semibold">Plugins</h2>
        <p className="mt-1 text-xs text-muted">
          {plugins.length} installed ·{' '}
          {plugins.filter((p) => p.enabled).length} enabled ·{' '}
          ~/.deepcode/plugins/
        </p>
      </header>

      <div className="border-b border-border p-3">
        <div className="flex gap-2">
          <input
            value={installSpec}
            onChange={(e) => setInstallSpec(e.target.value)}
            placeholder="gh:user/repo · <pkg>@npm · /local/path"
            className="flex-1 rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
          />
          <button
            onClick={handleInstall}
            disabled={installing || !installSpec.trim()}
            className="rounded bg-accent px-4 py-2 font-medium text-bg disabled:opacity-50"
          >
            {installing ? 'Installing…' : 'Install'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {plugins.length === 0 ? (
          <div className="p-8 text-center text-muted">
            <p>No plugins installed.</p>
            <p className="mt-2 text-xs">
              Try <code>gh:owner/repo</code> in the box above.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {plugins.map((p) => (
              <li key={p.name} className="rounded border border-border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-2 text-xs text-muted">v{p.version}</span>
                    <span
                      className={
                        'ml-2 rounded px-1 text-xs ' +
                        (p.trustedBy === 'official'
                          ? 'text-accent'
                          : p.trustedBy === 'marketplace'
                            ? 'text-fg'
                            : 'text-muted')
                      }
                    >
                      {p.trustedBy}
                    </span>
                  </div>
                  <div>
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={() => {
                        /* wire to window.deepcode.plugins.setEnabled */
                      }}
                    />
                  </div>
                </div>
                {p.contributedHookEvents.length > 0 && (
                  <div className="mt-1 text-xs text-muted">
                    Hooks: {p.contributedHookEvents.join(', ')}
                  </div>
                )}
                <div className="mt-1 text-xs text-muted font-mono">
                  hash: {p.sourceHash.slice(0, 12)}
                </div>
                {p.warning && <div className="mt-1 text-xs text-error">⚠ {p.warning}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
