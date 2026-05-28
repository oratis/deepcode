// "Relaunch to update vX.Y.Z" banner — fires when electron-updater has
// downloaded a new release. Click → app.relaunch() (host wires this in M6-rest).
// Spec: docs/VISUAL_DESIGN.html screen #11
// Milestone: M6 skeleton

import { useState } from 'react';
import type { UpdateInfo } from '../types/global.js';

interface BannerProps {
  info: UpdateInfo;
}

export function UpdateBanner({ info }: BannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex items-center justify-between border-b border-border bg-accent/10 px-4 py-2 text-sm">
      <span>
        DeepCode v{info.version} is ready to install. Relaunch to update.
      </span>
      <div className="flex gap-2">
        <button
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-bg"
          onClick={() => {
            // The renderer can't relaunch directly — main process listens for
            // this and calls app.relaunch(). Wiring in M6-rest.
            window.location.reload();
          }}
        >
          Relaunch now
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
