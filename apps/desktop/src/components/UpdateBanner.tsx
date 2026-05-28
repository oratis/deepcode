// "Relaunch to update vX.Y.Z" banner — fires when tauri-plugin-updater has
// downloaded a new release. Clicking Relaunch calls tauri-plugin-process.relaunch().
// Spec: docs/VISUAL_DESIGN.html screen #11

import { useState } from 'react';
import { relaunchNow } from '../lib/updater.js';
import type { UpdateInfo } from '../types/global.js';

interface BannerProps {
  info: UpdateInfo;
}

export function UpdateBanner({ info }: BannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  if (dismissed) return null;

  async function handleRelaunch(): Promise<void> {
    setRelaunching(true);
    try {
      await relaunchNow();
    } catch (err) {
      console.error('relaunch failed:', err);
      setRelaunching(false);
    }
  }

  return (
    <div className="flex items-center justify-between border-b border-border bg-accent/10 px-4 py-2 text-sm">
      <span>DeepCode v{info.version} is ready to install. Relaunch to update.</span>
      <div className="flex gap-2">
        <button
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-bg disabled:opacity-50"
          onClick={handleRelaunch}
          disabled={relaunching}
        >
          {relaunching ? 'Relaunching…' : 'Relaunch now'}
        </button>
        <button
          className="rounded px-3 py-1 text-xs text-muted"
          onClick={() => setDismissed(true)}
        >
          Later
        </button>
      </div>
    </div>
  );
}
