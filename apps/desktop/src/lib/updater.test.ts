import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';

const { check } = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));

function pendingInstallation() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const downloadAndInstall = vi.fn((onEvent: (event: DownloadEvent) => void) => {
    onEvent({ event: 'Finished' });
    return promise;
  });
  check.mockResolvedValue({
    available: true,
    version: '0.5.4',
    body: 'Release notes',
    downloadAndInstall,
  });
  return { downloadAndInstall, resolve, reject };
}

describe('update readiness', () => {
  beforeEach(() => {
    vi.resetModules();
    check.mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(['signature verification failed', 'installation failed'])(
    'does not offer a relaunch when download finishes but %s',
    async (reason) => {
      const installation = pendingInstallation();
      const { onUpdateDownloaded, startUpdaterPolling } = await import('./updater.js');
      const ready = vi.fn();
      const unsubscribe = onUpdateDownloaded(ready);
      startUpdaterPolling();
      await vi.waitFor(() => expect(installation.downloadAndInstall).toHaveBeenCalledOnce());
      expect(ready).not.toHaveBeenCalled();

      installation.reject(new Error(reason));
      await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith('[updater]', reason));
      expect(ready).not.toHaveBeenCalled();
      unsubscribe();
    },
  );

  it('offers a relaunch only after verified installation completes', async () => {
    const installation = pendingInstallation();
    const { onUpdateDownloaded, startUpdaterPolling } = await import('./updater.js');
    const ready = vi.fn();
    const unsubscribe = onUpdateDownloaded(ready);
    startUpdaterPolling();
    await vi.waitFor(() => expect(installation.downloadAndInstall).toHaveBeenCalledOnce());
    expect(ready).not.toHaveBeenCalled();

    installation.resolve();
    await vi.waitFor(() =>
      expect(ready).toHaveBeenCalledExactlyOnceWith({
        version: '0.5.4',
        releaseNotes: 'Release notes',
      }),
    );
    unsubscribe();
  });
});
