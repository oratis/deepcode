// Onboarding screen — first-run flow capturing the DeepSeek API key.
// Spec: docs/VISUAL_DESIGN.html screen #1
// Milestone: M6 skeleton

import { useState } from 'react';

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
    <div className="flex h-full items-center justify-center p-8">
      <form
        className="w-full max-w-md space-y-4 rounded-lg border border-border bg-bg-elevated p-6"
        onSubmit={handleSubmit}
      >
        <div>
          <h1 className="text-xl font-semibold">Welcome to DeepCode</h1>
          <p className="mt-1 text-sm text-muted">
            DeepCode talks to the DeepSeek API. Paste your key to get started.
          </p>
        </div>
        <label className="block">
          <span className="text-sm">DeepSeek API key</span>
          <input
            type="password"
            autoFocus
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="mt-1 w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-sm">Base URL (optional)</span>
          <input
            type="url"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
            className="mt-1 w-full rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
          />
        </label>
        {error && (
          <div className="rounded bg-error/10 px-3 py-2 text-sm text-error">{error}</div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-accent px-4 py-2 font-medium text-bg disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save & continue'}
        </button>
        <p className="text-xs text-muted">
          Your key is stored at <code>~/.deepcode/credentials.json</code> (chmod 600).
        </p>
      </form>
    </div>
  );
}
