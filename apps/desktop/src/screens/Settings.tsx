// Settings screen — design-aligned. Per spec screen #14.
// Top: JSON view (Monaco-lite). Bottom: flat key/value table. Both
// reflect the live settings file. Save button writes back.

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Card, Row, Screen, SectionTitle } from '../components/Screen.js';
import { loadProjectPath } from '../lib/project.js';
import { parseSettingsJson } from '../lib/settings-editor.js';
import { getSettingsPath, loadSettingsFile, saveSettingsFile } from '../lib/tauri-api.js';

export function SettingsScreen(): JSX.Element {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [settingsPath, setSettingsPath] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState<string | undefined>();
  const [rawJson, setRawJson] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'gui' | 'json'>('gui');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let disposed = false;
    setLoadError(null);
    void (async () => {
      try {
        const [s, path, project] = await Promise.all([
          loadSettingsFile(),
          getSettingsPath(),
          loadProjectPath(),
        ]);
        if (disposed) return;
        const json = JSON.stringify(s, null, 2);
        setSettings(parseSettingsJson(json));
        setSettingsPath(path);
        setProjectPath(project);
        setRawJson(json);
      } catch (err) {
        if (!disposed) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [loadAttempt]);

  function handleJsonChange(text: string): void {
    setRawJson(text);
    setFeedback(null);
    try {
      setSettings(parseSettingsJson(text));
      setParseError(null);
    } catch (err) {
      setParseError((err as Error).message);
    }
  }

  async function handleSave(): Promise<void> {
    if (!settings || parseError) return;
    setSaving(true);
    setFeedback(null);
    try {
      await saveSettingsFile(settings);
      setFeedback('✓ Saved to ' + (settingsPath ?? '~/.deepcode/settings.json'));
    } catch (err) {
      setFeedback(`✕ Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  // Flat key/value view
  const flat = useMemo(() => {
    const out: Array<{ key: string; value: string }> = [];
    function walk(prefix: string, obj: unknown): void {
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          walk(prefix ? `${prefix}.${k}` : k, v);
        }
      } else {
        out.push({ key: prefix, value: JSON.stringify(obj) });
      }
    }
    if (settings) walk('', settings);
    return out;
  }, [settings]);

  const visibleFlat = flat.filter(
    (e) =>
      !search ||
      e.key.toLowerCase().includes(search.toLowerCase()) ||
      e.value.toLowerCase().includes(search.toLowerCase()),
  );

  if (settings === null) {
    return (
      <Screen title="Settings">
        {loadError ? (
          <div style={{ padding: 20 }}>
            <p role="alert" style={{ color: 'var(--error)' }}>
              Could not load settings: {loadError}
            </p>
            <button type="button" className="btn" onClick={() => setLoadAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        ) : (
          <div role="status" style={{ padding: 20, color: 'var(--text-2)' }}>
            Loading settings…
          </div>
        )}
      </Screen>
    );
  }

  return (
    <Screen
      title="Settings"
      subtitle={`User settings · ${settingsPath ?? '~/.deepcode/settings.json'}`}
      actions={
        <>
          <div
            role="group"
            aria-label="Settings view"
            style={{
              display: 'flex',
              gap: 2,
              padding: 2,
              background: 'var(--bg-2)',
              border: '1px solid var(--line-soft)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {(['gui', 'json'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 4,
                  background: view === v ? 'var(--brand)' : 'transparent',
                  color: view === v ? '#fff' : 'var(--text-2)',
                  border: 0,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                {v === 'gui' ? 'Overview' : 'JSON'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || parseError !== null}
            title={parseError ?? 'Save to disk'}
          >
            {saving && <span className="spinner" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          The current conversation keeps the model, effort and mode shown in its composer. Open a
          new session to load saved defaults.
        </p>
        {feedback && (
          <div
            role={feedback.startsWith('✓') ? 'status' : 'alert'}
            style={{
              marginBottom: 14,
              padding: '8px 12px',
              background: feedback.startsWith('✓')
                ? 'rgba(20, 228, 162, 0.12)'
                : 'rgba(255, 84, 112, 0.12)',
              border:
                '1px solid ' +
                (feedback.startsWith('✓') ? 'rgba(20, 228, 162, 0.3)' : 'rgba(255, 84, 112, 0.3)'),
              color: feedback.startsWith('✓') ? 'var(--accent)' : 'var(--error)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
            }}
          >
            {feedback}
          </div>
        )}

        {view === 'gui' && (
          <>
            <Card title="Quick reference">
              <Row label="Project folder" hint="Threaded as cwd to every agent turn">
                {projectPath ? (
                  <code style={{ background: 'transparent' }}>{projectPath}</code>
                ) : (
                  <span style={{ color: 'var(--warn)' }}>not picked</span>
                )}
              </Row>
              <Row label="Settings file">
                <code style={{ background: 'transparent' }}>
                  {settingsPath ?? '~/.deepcode/settings.json'}
                </code>
              </Row>
              <Row label="Default model">
                <code style={{ background: 'transparent' }}>
                  {String(settings.model ?? 'deepseek-chat')}
                </code>
              </Row>
              <Row label="Default effort">
                <code style={{ background: 'transparent' }}>
                  {String(settings.effortLevel ?? 'medium')}
                </code>
              </Row>
              <Row label="Default base URL">
                <code style={{ background: 'transparent' }}>
                  {String(settings.baseURL ?? 'https://api.deepseek.com/v1')}
                </code>
              </Row>
            </Card>

            <Card
              title="All settings"
              actions={
                <input
                  type="search"
                  aria-label="Filter settings keys"
                  className="input"
                  placeholder="Filter keys…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    width: 200,
                    fontSize: 12,
                    padding: '4px 8px',
                    fontFamily: 'inherit',
                  }}
                />
              }
              flush
              padding={0}
            >
              {visibleFlat.length === 0 ? (
                <div
                  style={{
                    padding: 24,
                    textAlign: 'center',
                    color: 'var(--text-3)',
                    fontSize: 12,
                  }}
                >
                  {flat.length === 0 ? 'Settings file is empty.' : 'No matching keys.'}
                </div>
              ) : (
                <table
                  style={{
                    width: '100%',
                    fontSize: 12,
                    borderCollapse: 'collapse',
                  }}
                >
                  <thead>
                    <tr style={{ background: 'var(--bg-3)' }}>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '8px 14px',
                          fontSize: 10,
                          textTransform: 'uppercase',
                          color: 'var(--text-2)',
                          fontWeight: 600,
                          letterSpacing: 1,
                        }}
                      >
                        Key
                      </th>
                      <th
                        style={{
                          textAlign: 'left',
                          padding: '8px 14px',
                          fontSize: 10,
                          textTransform: 'uppercase',
                          color: 'var(--text-2)',
                          fontWeight: 600,
                          letterSpacing: 1,
                        }}
                      >
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleFlat.map((e) => (
                      <tr key={e.key} style={{ borderTop: '1px solid var(--line-soft)' }}>
                        <td
                          style={{
                            padding: '8px 14px',
                            fontFamily: 'JetBrains Mono, monospace',
                            color: 'var(--text-0)',
                          }}
                        >
                          {e.key}
                        </td>
                        <td
                          style={{
                            padding: '8px 14px',
                            fontFamily: 'JetBrains Mono, monospace',
                            color: 'var(--text-2)',
                            wordBreak: 'break-all',
                          }}
                        >
                          {e.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <SectionTitle>Tip</SectionTitle>
            <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
              Use the JSON view (toggle in the header) to edit nested keys and arrays directly. Save
              validates JSON before writing.
            </div>
          </>
        )}

        {view === 'json' && (
          <Card title="Raw JSON" padding={0}>
            <textarea
              ref={textareaRef}
              aria-label="Settings JSON"
              aria-invalid={parseError !== null}
              aria-describedby={parseError ? 'settings-json-error' : undefined}
              value={rawJson}
              disabled={saving}
              onChange={(e) => handleJsonChange(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: 480,
                background: 'var(--bg-0)',
                color: 'var(--text-0)',
                border: 0,
                padding: '14px 16px',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12.5,
                lineHeight: 1.6,
                resize: 'vertical',
              }}
            />
            {parseError && (
              <div
                id="settings-json-error"
                role="alert"
                style={{
                  padding: '8px 16px',
                  background: 'rgba(255, 84, 112, 0.12)',
                  borderTop: '1px solid rgba(255, 84, 112, 0.3)',
                  color: 'var(--error)',
                  fontSize: 11,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {parseError}
              </div>
            )}
          </Card>
        )}
      </div>
    </Screen>
  );
}
