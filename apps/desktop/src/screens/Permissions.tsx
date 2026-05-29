// Permissions screen — design-aligned. Per spec screen #10.
// View + edit settings.permissions rules. Save now actually persists
// to ~/.deepcode/settings.json via saveSettingsFile.

import { useEffect, useState } from 'react';
import { Badge, type BadgeKind } from '../components/Badge.js';
import { Card, Row, Screen, SectionTitle } from '../components/Screen.js';
import { loadSettingsFile, saveSettingsFile } from '../lib/tauri-api.js';

type RuleType = 'allow' | 'ask' | 'deny';

interface PermissionsView {
  defaultMode: string;
  allow: string[];
  ask: string[];
  deny: string[];
  additionalDirectories: string[];
}

const RULE_BADGE: Record<RuleType, { kind: BadgeKind; label: string }> = {
  allow: { kind: 'ok', label: 'allow' },
  ask: { kind: 'warn', label: 'ask' },
  deny: { kind: 'err', label: 'deny' },
};

export function PermissionsScreen(): JSX.Element {
  const [perm, setPerm] = useState<PermissionsView | null>(null);
  const [newRule, setNewRule] = useState({
    type: 'allow' as RuleType,
    pattern: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const settings = (await loadSettingsFile()) as Record<string, unknown>;
        const p = (settings.permissions as Partial<PermissionsView> | undefined) ?? {};
        setPerm({
          defaultMode: p.defaultMode ?? 'default',
          allow: p.allow ?? [],
          ask: p.ask ?? [],
          deny: p.deny ?? [],
          additionalDirectories: p.additionalDirectories ?? [],
        });
      } catch {
        setPerm({
          defaultMode: 'default',
          allow: [],
          ask: [],
          deny: [],
          additionalDirectories: [],
        });
      }
    })();
  }, []);

  function addRule(): void {
    if (!newRule.pattern.trim()) return;
    setPerm((p) =>
      p
        ? {
            ...p,
            [newRule.type]: [...p[newRule.type], newRule.pattern.trim()],
          }
        : p,
    );
    setNewRule({ type: 'allow', pattern: '' });
    setSaveMsg(null);
  }

  function removeRule(type: RuleType, idx: number): void {
    setPerm((p) => (p ? { ...p, [type]: p[type].filter((_, i) => i !== idx) } : p));
    setSaveMsg(null);
  }

  async function handleSave(): Promise<void> {
    if (!perm) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const current = (await loadSettingsFile()) as Record<string, unknown>;
      await saveSettingsFile({
        ...current,
        permissions: {
          defaultMode: perm.defaultMode,
          allow: perm.allow,
          ask: perm.ask,
          deny: perm.deny,
          additionalDirectories: perm.additionalDirectories,
        },
      });
      setSaveMsg('✓ Saved to ~/.deepcode/settings.json');
    } catch (err) {
      setSaveMsg(`✕ Failed to save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (perm === null) {
    return (
      <Screen title="Permissions">
        <div style={{ padding: 20, color: 'var(--text-2)' }}>Loading…</div>
      </Screen>
    );
  }

  return (
    <Screen
      title="Permissions"
      subtitle="deny > ask > allow"
      actions={
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving && <span className="spinner" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        {saveMsg && (
          <div
            style={{
              marginBottom: 14,
              padding: '8px 12px',
              background: saveMsg.startsWith('✓')
                ? 'rgba(20, 228, 162, 0.12)'
                : 'rgba(255, 84, 112, 0.12)',
              border:
                '1px solid ' +
                (saveMsg.startsWith('✓') ? 'rgba(20, 228, 162, 0.3)' : 'rgba(255, 84, 112, 0.3)'),
              color: saveMsg.startsWith('✓') ? 'var(--accent)' : 'var(--error)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 12,
            }}
          >
            {saveMsg}
          </div>
        )}

        <Card title="Default mode">
          <Row label="Mode">
            <code style={{ background: 'transparent' }}>{perm.defaultMode}</code>
          </Row>
        </Card>

        <Card title="Add rule">
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={newRule.type}
              onChange={(e) => setNewRule({ ...newRule, type: e.target.value as RuleType })}
              className="input"
              style={{ width: 110, fontFamily: 'inherit' }}
            >
              <option value="allow">allow</option>
              <option value="ask">ask</option>
              <option value="deny">deny</option>
            </select>
            <input
              value={newRule.pattern}
              onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
              placeholder="e.g. Bash(npm test:*) or Read(./src/**)"
              className="input"
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addRule();
              }}
            />
            <button
              type="button"
              onClick={addRule}
              disabled={!newRule.pattern.trim()}
              className="btn btn-secondary"
            >
              Add
            </button>
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: 'var(--text-3)',
              lineHeight: 1.5,
            }}
          >
            Pattern syntax: bare tool name (<code>Bash</code>) · subcommand (
            <code>Bash(git:*)</code>) · prefix (<code>Read(/etc/*)</code>) · domain (
            <code>WebFetch(domain:github.com)</code>).
          </div>
        </Card>

        {(['deny', 'ask', 'allow'] as const).map((kind) => {
          const badge = RULE_BADGE[kind];
          const rules = perm[kind];
          return (
            <Card
              key={kind}
              title={`${badge.label} (${rules.length})`}
              actions={<Badge kind={badge.kind}>{badge.label}</Badge>}
              flush
              padding={0}
            >
              {rules.length === 0 ? (
                <div
                  style={{
                    padding: 16,
                    fontSize: 12,
                    color: 'var(--text-3)',
                    textAlign: 'center',
                  }}
                >
                  no rules
                </div>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {rules.map((p, i) => (
                    <li
                      key={i}
                      style={{
                        padding: '8px 16px',
                        borderBottom:
                          i === rules.length - 1 ? 'none' : '1px solid var(--line-soft)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: 'var(--text-0)' }}>{p}</span>
                      <button
                        type="button"
                        onClick={() => removeRule(kind, i)}
                        style={{
                          marginLeft: 'auto',
                          color: 'var(--text-3)',
                          fontSize: 14,
                          background: 'transparent',
                          border: 0,
                          cursor: 'pointer',
                          padding: '2px 6px',
                          borderRadius: 4,
                        }}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}

        {perm.additionalDirectories.length > 0 && (
          <Card
            title={`Additional directories (${perm.additionalDirectories.length})`}
            flush
            padding={0}
          >
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {perm.additionalDirectories.map((d, i) => (
                <li
                  key={i}
                  style={{
                    padding: '8px 16px',
                    borderBottom:
                      i === perm.additionalDirectories.length - 1
                        ? 'none'
                        : '1px solid var(--line-soft)',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 12,
                    color: 'var(--text-0)',
                  }}
                >
                  {d}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <SectionTitle>Notes</SectionTitle>
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6 }}>
          Inline "Always allow" buttons in the chat (over a pending tool card) also write to this
          list. Removing a rule here disables it immediately for the next tool call.
        </div>
      </div>
    </Screen>
  );
}
