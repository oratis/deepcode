// About screen — version + diagnostics + links.
// Spec: docs/VISUAL_DESIGN.html (about / doctor)
// Milestone: M6-rest

import { useEffect, useState } from 'react';

interface Diag {
  version: string;
  hasCreds: boolean;
  baseURL?: string;
}

export function AboutScreen(): JSX.Element {
  const [diag, setDiag] = useState<Diag | null>(null);

  useEffect(() => {
    void Promise.all([window.deepcode.version(), window.deepcode.creds.load()]).then(
      ([version, c]) => setDiag({ version, hasCreds: c.hasKey, baseURL: c.baseURL }),
    );
  }, []);

  if (diag === null) return <div className="p-8 text-muted">Loading…</div>;

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-elevated p-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold">DeepCode</h1>
          <p className="mt-1 text-sm text-muted">
            DeepSeek-powered AI coding agent · Claude Code parity
          </p>
        </div>

        <dl className="mt-6 space-y-2 text-sm">
          <Row label="Version" value={`v${diag.version}`} />
          <Row label="DeepSeek API" value={diag.hasCreds ? '✓ configured' : '✗ not configured'} />
          <Row label="Base URL" value={diag.baseURL ?? 'https://api.deepseek.com/v1'} />
          <Row label="Credentials" value="~/.deepcode/credentials.json (chmod 600)" />
          <Row label="Settings" value="~/.deepcode/settings.json" />
          <Row label="Sessions" value="~/.deepcode/sessions/" />
        </dl>

        <div className="mt-6 space-y-2 text-center text-xs">
          <a
            className="block text-accent hover:underline"
            href="https://github.com/oratis/deepcode"
          >
            github.com/oratis/deepcode
          </a>
          <a
            className="block text-accent hover:underline"
            href="https://github.com/oratis/deepcode/blob/main/docs/security-model.md"
          >
            Security model
          </a>
          <a
            className="block text-accent hover:underline"
            href="https://github.com/oratis/deepcode/blob/main/docs/BEHAVIOR_PARITY.md"
          >
            Behavior parity vs Claude Code
          </a>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}
