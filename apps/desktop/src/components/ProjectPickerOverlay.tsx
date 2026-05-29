// First-run overlay: shown after onboarding but before chat is usable.
// User picks a project folder via the native macOS file picker; the
// path is persisted to settings.json#projectPath and threaded into
// every agent.start as `cwd`.

import { useState } from 'react';
import { BrandMark } from './BrandMark.js';
import { pickFolder } from '../lib/tauri-api.js';

interface Props {
  onPicked: (path: string) => void;
}

export function ProjectPickerOverlay({ onPicked }: Props): JSX.Element {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handlePick(): Promise<void> {
    setPending(true);
    setErr(null);
    try {
      const path = await pickFolder();
      if (!path) {
        setPending(false);
        return; // user cancelled
      }
      onPicked(path);
    } catch (e) {
      setErr((e as Error).message ?? String(e));
      setPending(false);
    }
  }

  return (
    <div className="onboarding">
      <div className="card">
        <span className="brand-chip">
          <BrandMark />
          DeepCode
        </span>

        <h1>Pick a project folder.</h1>
        <p className="tagline">
          Everything DeepCode reads, writes, runs, or remembers happens inside one folder you
          choose. You can switch projects anytime from the sidebar.
        </p>

        <div
          style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-lg)',
            padding: 32,
            textAlign: 'center',
            boxShadow: 'var(--shadow)',
          }}
        >
          <div
            style={{
              fontSize: 48,
              marginBottom: 12,
              color: 'var(--text-2)',
            }}
          >
            📁
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-2)',
              marginBottom: 18,
              lineHeight: 1.6,
            }}
          >
            Common picks: a git repo, a single project root, or a sandboxed scratch directory.
            DeepCode will never read or write outside the folder you pick.
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handlePick}
            disabled={pending}
            style={{ fontSize: 14 }}
          >
            {pending && <span className="spinner" />}
            {pending ? 'Opening picker…' : 'Choose folder…'}
          </button>

          {err && (
            <div
              style={{
                marginTop: 14,
                padding: '8px 12px',
                background: 'rgba(255, 84, 112, 0.12)',
                border: '1px solid rgba(255, 84, 112, 0.3)',
                color: 'var(--error)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
              }}
            >
              {err}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 16,
            fontSize: 11,
            color: 'var(--text-3)',
            textAlign: 'center',
          }}
        >
          The path is saved to ~/.deepcode/settings.json so you don't have to pick again on next
          launch.
        </div>
      </div>
    </div>
  );
}
