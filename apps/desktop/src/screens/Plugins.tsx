// Installed plugin manifests and saved load preferences. Activation remains host-owned.

import { useEffect, useRef, useState, type JSX } from 'react';
import { Badge, type BadgeKind } from '../components/Badge.js';
import { Card, Screen } from '../components/Screen.js';
import { loadSettingsFile, saveSettingsFile } from '../lib/tauri-api.js';

interface PluginRow {
  name: string;
  version: string;
  contributedHookEvents: string[];
  sourceHash: string;
  trustedBy: 'user' | 'marketplace' | 'official';
  warning?: string;
  configuredEnabled: boolean;
}

const TRUST_BADGE: Record<PluginRow['trustedBy'], { kind: BadgeKind; label: string }> = {
  official: { kind: 'ok', label: 'official' },
  marketplace: { kind: 'info', label: 'marketplace' },
  user: { kind: 'warn', label: 'user-installed' },
};

export function PluginsScreen(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginRow[] | null>(null);
  const [savingName, setSavingName] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    setLoadError(null);
    setPlugins(null);
    void (async () => {
      try {
        const list = window.deepcode?.plugins?.list;
        if (!list) throw new Error('Plugin listing is unavailable in this client.');
        const [rows, settings] = await Promise.all([list(), loadSettingsFile()]);
        if (disposed) return;
        const disabled = new Set(
          Array.isArray(settings.disabledPlugins) ? (settings.disabledPlugins as string[]) : [],
        );
        setPlugins(
          rows.map((p) => ({
            ...p,
            configuredEnabled: !disabled.has(p.name),
          })),
        );
      } catch (err) {
        if (!disposed) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [loadAttempt]);

  async function handleToggle(name: string, nextEnabled: boolean): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavingName(name);
    setFeedback(null);
    try {
      const current = await loadSettingsFile();
      const disabled = new Set(
        Array.isArray(current.disabledPlugins) ? (current.disabledPlugins as string[]) : [],
      );
      if (nextEnabled) disabled.delete(name);
      else disabled.add(name);
      await saveSettingsFile({ ...current, disabledPlugins: [...disabled] });
      setPlugins((ps) =>
        ps ? ps.map((p) => (p.name === name ? { ...p, configuredEnabled: nextEnabled } : p)) : ps,
      );
      setFeedback({
        text: `Saved: "${name}" is configured ${nextEnabled ? 'on' : 'off'} for future turns. Trust and runtime checks still apply.`,
        error: false,
      });
    } catch (err) {
      setFeedback({
        text: `Could not save preference: ${err instanceof Error ? err.message : String(err)}`,
        error: true,
      });
    } finally {
      savingRef.current = false;
      setSavingName(null);
    }
  }

  return (
    <Screen
      title="Plugins"
      subtitle={
        plugins ? `${plugins.length} installed · User load preferences` : 'User load preferences'
      }
      actions={
        <button
          type="button"
          className="btn"
          disabled={savingName !== null || (plugins === null && !loadError)}
          onClick={() => setLoadAttempt((n) => n + 1)}
        >
          Refresh
        </button>
      }
    >
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <Card title="Install from the terminal">
          <p style={{ margin: '0 0 10px', color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>
            Desktop installation is not available yet. Use the CLI to install a plugin, then refresh
            this list.
          </p>
          <code>deepcode plugins install &lt;spec&gt;</code>
          <p style={{ margin: '10px 0 0', color: 'var(--text-3)', fontSize: 12 }}>
            Accepts gh:owner/repo, a package with @npm, or a local path.
          </p>
        </Card>

        <Card title="Installed plugins" flush padding={0}>
          <p
            style={{
              margin: 0,
              padding: '14px 16px',
              color: 'var(--text-2)',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            Load preferences apply to future turns. This list shows installed manifests and saved
            preferences; it does not confirm that a plugin is active. Untrusted plugins still need
            approval through the CLI.
          </p>
          {feedback && (
            <p
              role={feedback.error ? 'alert' : 'status'}
              style={{
                padding: '0 16px',
                color: feedback.error ? 'var(--error)' : 'var(--accent)',
                fontSize: 12,
              }}
            >
              {feedback.text}
            </p>
          )}
          {loadError ? (
            <div style={{ padding: '0 16px 16px' }}>
              <p role="alert" style={{ color: 'var(--error)' }}>
                Could not load plugins: {loadError}
              </p>
              <button type="button" className="btn" onClick={() => setLoadAttempt((n) => n + 1)}>
                Retry
              </button>
            </div>
          ) : plugins === null ? (
            <p role="status" style={{ padding: '0 16px 16px', color: 'var(--text-2)' }}>
              Loading plugins…
            </p>
          ) : plugins.length === 0 ? (
            <p
              style={{ padding: '16px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}
            >
              No plugins installed yet.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {plugins.map((p) => {
                const trust = TRUST_BADGE[p.trustedBy] ?? TRUST_BADGE.user;
                return (
                  <li
                    key={p.name}
                    style={{ padding: '14px 16px', borderTop: '1px solid var(--line-soft)' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flexWrap: 'wrap',
                        marginBottom: 6,
                      }}
                    >
                      <strong style={{ color: 'var(--text-0)', fontSize: 13 }}>{p.name}</strong>
                      <span style={{ color: 'var(--text-3)', fontSize: 11 }}>v{p.version}</span>
                      <Badge kind={trust.kind}>{trust.label}</Badge>
                      <label
                        style={{
                          marginLeft: 'auto',
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          fontSize: 12,
                        }}
                      >
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`Load ${p.name} on future turns`}
                          checked={p.configuredEnabled}
                          disabled={savingName !== null}
                          onChange={() => void handleToggle(p.name, !p.configuredEnabled)}
                        />
                        {savingName === p.name
                          ? 'Saving…'
                          : `Configured ${p.configuredEnabled ? 'on' : 'off'}`}
                      </label>
                    </div>
                    {p.contributedHookEvents.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
                        Hooks: {p.contributedHookEvents.join(', ')}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace' }}>
                      {p.sourceHash
                        ? `Recorded hash ${p.sourceHash.slice(0, 12)}`
                        : 'No recorded trust hash'}
                    </div>
                    {p.warning && (
                      <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--warn)' }}>
                        {p.warning}
                      </p>
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
