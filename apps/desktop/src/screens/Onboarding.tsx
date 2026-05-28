// Onboarding screen — first-run flow capturing the DeepSeek API key.
// Design spec: docs/VISUAL_DESIGN.html screen #2 (hero gradient + big mark).

import { useState } from 'react';
import { BrandMark } from '../components/BrandMark.js';
import { openUrl } from '../lib/tauri-api.js';

interface OnboardingProps {
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: OnboardingProps): JSX.Element {
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('API key is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await window.deepcode.creds.save({
        apiKey: apiKey.trim(),
        baseURL: baseURL.trim() || undefined,
      });
      onComplete();
    } catch (err) {
      setError((err as Error).message ?? 'Failed to save credentials.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="onboarding">
      <div className="card">
        <span className="brand-chip">
          <BrandMark />
          DeepCode
        </span>

        <h1>DeepSeek-powered coding agent.</h1>
        <p className="tagline">
          From this key to your first edit in under 90 seconds.
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="api-key">DeepSeek API Key</label>
          <input
            id="api-key"
            type="password"
            className="input"
            placeholder="sk-..."
            autoFocus
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="hint">
            Get one at{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                void openUrl('https://platform.deepseek.com/api_keys');
              }}
            >
              platform.deepseek.com
            </a>
            . Your key is stored locally in ~/.deepcode/credentials.json — it
            never leaves your machine except to call api.deepseek.com.
          </div>

          <div style={{ marginTop: 16 }}>
            <label htmlFor="base-url">Custom base URL (optional, for proxies)</label>
            <input
              id="base-url"
              type="text"
              className="input"
              placeholder="https://api.deepseek.com/v1"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {error && <div className="error">{error}</div>}

          <div className="actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !apiKey.trim()}
            >
              {submitting && <span className="spinner" />}
              {submitting ? 'Saving…' : 'Continue →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
