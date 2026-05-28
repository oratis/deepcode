// Electron preload — bridges renderer to the trusted main process via
// contextBridge. The renderer can ONLY call these exposed APIs; raw `require`
// and Node globals are disabled.
// Spec: docs/DEVELOPMENT_PLAN.md §4
// Milestone: M6

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  creds: {
    load: (): Promise<{ hasKey: boolean; baseURL?: string }> =>
      ipcRenderer.invoke('creds:load'),
    save: (args: { apiKey: string; baseURL?: string }): Promise<boolean> =>
      ipcRenderer.invoke('creds:save', args),
  },
  settings: {
    load: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('settings:load'),
  },
  /** Subscribe to "update downloaded" events from the auto-updater. */
  onUpdateDownloaded: (cb: (info: { version: string; releaseNotes?: string }) => void): (() => void) => {
    const listener = (_e: unknown, info: { version: string; releaseNotes?: string }) => cb(info);
    ipcRenderer.on('updater:update-downloaded', listener);
    return () => ipcRenderer.removeListener('updater:update-downloaded', listener);
  },
};

contextBridge.exposeInMainWorld('deepcode', api);

// Type declaration for the renderer (mirrored manually in src/types/global.d.ts)
export type DeepCodeRendererAPI = typeof api;
