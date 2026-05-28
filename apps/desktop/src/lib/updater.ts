// Tauri auto-updater wiring.
// Spec: docs/DEVELOPMENT_PLAN.md §4b
//
// On app start, we silently poll the GitHub Releases feed. When a newer
// release is available, we download it in the background and fire an
// `update-downloaded` event the renderer listens for (UpdateBanner UI).
//
// Privacy: only a single HEAD-equivalent JSON fetch to the GitHub
// releases endpoint. No telemetry beyond that.

import { check, type Update } from '@tauri-apps/plugin-updater';

type UpdateInfoCb = (info: { version: string; releaseNotes?: string }) => void;

const listeners: UpdateInfoCb[] = [];

/** Subscribe to update-downloaded events. Returns an unsubscribe fn. */
export function onUpdateDownloaded(cb: UpdateInfoCb): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function emit(info: { version: string; releaseNotes?: string }): void {
  for (const l of listeners) {
    try {
      l(info);
    } catch {
      /* listeners are isolated */
    }
  }
}

/** Begin background update polling. Safe to call multiple times — only the
 *  first call actually polls. */
let pollStarted = false;
export function startUpdaterPolling(): void {
  if (pollStarted) return;
  pollStarted = true;
  void checkAndDownloadOnce().catch((err) => {
    // Silent — offline / no releases yet shouldn't bother the user.
    console.warn('[updater]', (err as Error).message);
  });
}

async function checkAndDownloadOnce(): Promise<void> {
  let update: Update | null = null;
  try {
    update = await check();
  } catch (err) {
    // Network error / endpoint 404 → expected during early ship phase.
    console.warn('[updater] check failed:', (err as Error).message);
    return;
  }
  if (!update?.available) {
    console.info('[updater] up to date');
    return;
  }
  console.info(`[updater] new version available: ${update.version}`);
  // Stream-download with progress; finishOnLoad triggers immediately.
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      console.info(`[updater] downloading ${event.data.contentLength ?? 0} bytes`);
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
    } else if (event.event === 'Finished') {
      console.info(`[updater] downloaded ${downloaded} bytes — ready`);
      emit({
        version: update?.version ?? '',
        releaseNotes: update?.body ?? undefined,
      });
    }
  });
}

/** Trigger app relaunch (after update is installed). Called from the
 *  UpdateBanner "Relaunch now" button. */
export async function relaunchNow(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
