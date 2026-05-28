// About screen — design-aligned per docs/VISUAL_DESIGN.html.
// Brand mark + version + diagnostics + docs links.

import { useEffect, useState } from 'react';
import { BrandMark } from '../components/BrandMark.js';
import { Card, Row, Screen, SectionTitle } from '../components/Screen.js';
import { loadProjectPath } from '../lib/project.js';
import { openUrl } from '../lib/tauri-api.js';

interface Diag {
  version: string;
  hasCreds: boolean;
  baseURL?: string;
  projectPath?: string;
}

export function AboutScreen(): JSX.Element {
  const [diag, setDiag] = useState<Diag | null>(null);

  useEffect(() => {
    void (async () => {
      const [version, creds, projectPath] = await Promise.all([
        window.deepcode.version(),
        window.deepcode.creds.load(),
        loadProjectPath(),
      ]);
      setDiag({
        version,
        hasCreds: creds.hasKey,
        baseURL: creds.baseURL,
        projectPath,
      });
    })();
  }, []);

  if (diag === null) {
    return (
      <Screen title="About">
        <div style={{ padding: 20, color: 'var(--text-2)' }}>Loading…</div>
      </Screen>
    );
  }

  return (
    <Screen title="About">
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Brand block */}
        <div
          style={{
            textAlign: 'center',
            padding: '32px 0 24px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <BrandMark size="lg" />
          </div>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: -1,
              margin: '0 0 8px',
              background: 'linear-gradient(180deg, var(--text-0) 0%, var(--brand) 140%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            DeepCode
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: 14, margin: 0 }}>
            DeepSeek-powered AI coding agent · Claude Code parity
          </p>
          <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 6 }}>
            v{diag.version}
          </p>
        </div>

        {/* Diagnostics */}
        <Card title="Diagnostics">
          <SectionTitle>Status</SectionTitle>
          <Row label="DeepSeek API">
            {diag.hasCreds ? (
              <span style={{ color: 'var(--accent)' }}>✓ configured</span>
            ) : (
              <span style={{ color: 'var(--error)' }}>✗ not configured</span>
            )}
          </Row>
          <Row label="Project folder">
            {diag.projectPath ? (
              <code style={{ background: 'transparent' }}>{diag.projectPath}</code>
            ) : (
              <span style={{ color: 'var(--warn)' }}>none picked</span>
            )}
          </Row>
          <Row label="Base URL">
            <code style={{ background: 'transparent' }}>
              {diag.baseURL ?? 'https://api.deepseek.com/v1'}
            </code>
          </Row>

          <SectionTitle>Paths</SectionTitle>
          <Row label="Credentials" hint="0600 perms — never readable by other users">
            <code style={{ background: 'transparent' }}>
              ~/.deepcode/credentials.json
            </code>
          </Row>
          <Row label="Settings">
            <code style={{ background: 'transparent' }}>
              ~/.deepcode/settings.json
            </code>
          </Row>
          <Row label="Sessions">
            <code style={{ background: 'transparent' }}>
              ~/.deepcode/sessions/
            </code>
          </Row>
          <Row label="Keybindings">
            <code style={{ background: 'transparent' }}>
              ~/.deepcode/keybindings.json
            </code>
          </Row>
        </Card>

        {/* Links */}
        <Card title="Documentation & community">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              ['github.com/oratis/deepcode', 'https://github.com/oratis/deepcode'],
              [
                'Security model',
                'https://github.com/oratis/deepcode/blob/main/docs/security-model.md',
              ],
              [
                'Behavior parity vs Claude Code',
                'https://github.com/oratis/deepcode/blob/main/docs/BEHAVIOR_PARITY.md',
              ],
              [
                'CHANGELOG',
                'https://github.com/oratis/deepcode/blob/main/CHANGELOG.md',
              ],
            ].map(([label, href]) => (
              <a
                key={href}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl(href!);
                }}
                style={{
                  color: '#b4c2ff',
                  fontSize: 13,
                  padding: '6px 0',
                }}
              >
                {label} →
              </a>
            ))}
          </div>
        </Card>
      </div>
    </Screen>
  );
}
