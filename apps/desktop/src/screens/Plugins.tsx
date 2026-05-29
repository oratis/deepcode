// Plugins screen — design-aligned. Per spec screen #12.
// List installed plugins, their trust state + contributed hooks,
// enable/disable, install new ones. Install IPC still stubbed (P3
// will wire installFromSpec).

import { useEffect, useState } from 'react';
import { Badge, type BadgeKind } from '../components/Badge.js';
import { Card, Screen } from '../components/Screen.js';
import { loadSettingsFile, saveSettingsFile } from '../lib/tauri-api.js';

interface PluginRow {
  name: string;
  version: string;
  enabled: boolean;
  contributedHookEvents: string[];
  sourceHash: string;
  trustedBy: 'user' | 'marketplace' | 'official';
  warning?: string;
}

const TRUST_BADGE: Record<PluginRow['trustedBy'], { kind: BadgeKind; label: string }> = {
  official: { kind: 'ok', label: 'official' },
  marketplace: { kind: 'info', label: 'marketplace' },
  user: { kind: 'warn', label: 'user-installed' },
};

export function PluginsScreen(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginRow[] | null>(null);
  const [installSpec, setInstallSpec] = useState('');
  const [installing, setInstalling] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Initial load — merge live list with settings.disabledPlugins[].
  useEffect(() => {
    void (async () => {
      try {
        const [rows, settings] = await Promise.all([
          window.deepcode?.plugins?.list?.() ?? Promise.resolve([]),
          loadSettingsFile().catch(() => ({}) as Record<string, unknown>),
        ]);
        const disabled = new Set(
          Array.isArray(settings.disabledPlugins) ? (settings.disabledPlugins as string[]) : [],
        );
        const merged = (rows as PluginRow[]).map((p) => ({
          ...p,
          enabled: !disabled.has(p.name),
        }));
        setPlugins(merged);
      } catch {
        setPlugins([]);
      }
    })();
  }, []);

  async function handleToggle(name: string, nextEnabled: boolean): Promise<void> {
    // Optimistic UI
    setPlugins((ps) =>
      ps ? ps.map((p) => (p.name === name ? { ...p, enabled: nextEnabled } : p)) : ps,
    );
    try {
      const current = (await loadSettingsFile()) as Record<string, unknown>;
      const disabled = new Set(
        Array.isArray(current.disabledPlugins) ? (current.disabledPlugins as string[]) : [],
      );
      if (nextEnabled) disabled.delete(name);
      else disabled.add(name);
      await saveSettingsFile({
        ...current,
        disabledPlugins: [...disabled],
      });
      setFeedback(
        `✓ ${nextEnabled ? 'Enabled' : 'Disabled'} "${name}". Takes effect on next agent turn.`,
      );
    } catch (err) {
      // Revert
      setPlugins((ps) =>
        ps ? ps.map((p) => (p.name === name ? { ...p, enabled: !nextEnabled } : p)) : ps,
      );
      setFeedback(`✕ Toggle failed: ${(err as Error).message}`);
    }
  }

  async function handleInstall(): Promise<void> {
    if (!installSpec.trim()) return;
    setInstalling(true);
    setFeedback(null);
    try {
      // Plugin install via Tauri is still not wired — surface that clearly.
      await new Promise((r) => setTimeout(r, 400));
      setFeedback(
        'Plugin install from the desktop UI is coming in v0.2. For now, install via the CLI: `deepcode plugin install ' +
          installSpec.trim() +
          '`',
      );
    } finally {
      setInstalling(false);
    }
  }

  if (plugins === null) {
    return (
      <Screen title="Plugins">
        <div style={{ padding: 20, color: 'var(--text-2)' }}>Loading…</div>
      </Screen>
    );
  }

  const enabled = plugins.filter((p) => p.enabled).length;

  return (
    <Screen title="Plugins" subtitle={`${plugins.length} installed · ${enabled} enabled`}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <Card title="Install new plugin">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={installSpec}
              onChange={(e) => setInstallSpec(e.target.value)}
              placeholder="gh:user/repo · <pkg>@npm · /local/path"
              className="input"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={handleInstall}
              disabled={installing || !installSpec.trim()}
              className="btn btn-primary"
            >
              {installing && <span className="spinner" />}
              {installing ? 'Installing…' : 'Install'}
            </button>
          </div>
          {feedback && (
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                background: 'rgba(255, 176, 32, 0.12)',
                border: '1px solid rgba(255, 176, 32, 0.3)',
                color: 'var(--warn)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {feedback}
            </div>
          )}
        </Card>

        <Card title={`Installed (${plugins.length})`} flush padding={0}>
          {plugins.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--text-3)',
                fontSize: 13,
              }}
            >
              No plugins installed yet.
              <div style={{ marginTop: 6, fontSize: 11 }}>
                Try <code>gh:owner/repo</code> in the box above (or via CLI).
              </div>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {plugins.map((p, i) => {
                const trust = TRUST_BADGE[p.trustedBy];
                return (
                  <li
                    key={p.name}
                    style={{
                      padding: '14px 16px',
                      borderBottom:
                        i === plugins.length - 1 ? 'none' : '1px solid var(--line-soft)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: 6,
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          color: 'var(--text-0)',
                          fontSize: 13,
                        }}
                      >
                        {p.name}
                      </span>
                      <span
                        style={{
                          color: 'var(--text-3)',
                          fontSize: 11,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        v{p.version}
                      </span>
                      <Badge kind={trust.kind}>{trust.label}</Badge>
                      <span style={{ marginLeft: 'auto' }}>
                        <Toggle
                          checked={p.enabled}
                          onChange={() => void handleToggle(p.name, !p.enabled)}
                        />
                      </span>
                    </div>
                    {p.contributedHookEvents.length > 0 && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-2)',
                          marginBottom: 2,
                        }}
                      >
                        Hooks:{' '}
                        <span style={{ color: '#b4c2ff' }}>
                          {p.contributedHookEvents.join(', ')}
                        </span>
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-3)',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      hash {p.sourceHash.slice(0, 12)}
                    </div>
                    {p.warning && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11,
                          color: 'var(--error)',
                        }}
                      >
                        ⚠ {p.warning}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </Screen>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
}

function Toggle({ checked, onChange }: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      style={{
        width: 32,
        height: 18,
        borderRadius: 999,
        background: checked ? 'var(--brand)' : 'var(--bg-3)',
        border: 'none',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }}
      />
    </button>
  );
}
