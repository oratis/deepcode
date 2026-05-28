// Electron preload — bridges renderer to the trusted main process via
// contextBridge. The renderer can ONLY call these exposed APIs; raw `require`
// and Node globals are disabled.
// Spec: docs/DEVELOPMENT_PLAN.md §4 + packages/core/src/ipc/protocol.ts
// Milestone: M6 + M6-rest

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

  sessions: {
    list: (
      args: { limit?: number } = {},
    ): Promise<
      Array<{ id: string; title?: string; cwd: string; updatedAt: string; model?: string }>
    > => ipcRenderer.invoke('sessions:list', args),
    resume: (
      args: { id: string },
    ): Promise<{ history: unknown[]; sessionId: string }> =>
      ipcRenderer.invoke('sessions:resume', args),
  },

  plugins: {
    list: (): Promise<
      Array<{
        name: string;
        version: string;
        enabled: boolean;
        sourceHash: string;
        trustedBy: 'user' | 'marketplace' | 'official';
        contributedHookEvents: string[];
      }>
    > => ipcRenderer.invoke('plugins:list'),
    install: (args: { spec: string }): Promise<{ name: string; version: string }> =>
      ipcRenderer.invoke('plugins:install', args),
    setEnabled: (args: { name: string; enabled: boolean }): Promise<boolean> =>
      ipcRenderer.invoke('plugins:setEnabled', args),
  },

  mcp: {
    list: (): Promise<
      Array<{
        name: string;
        status: 'connected' | 'failed' | 'disabled';
        toolCount?: number;
        error?: string;
      }>
    > => ipcRenderer.invoke('mcp:list'),
  },

  skills: {
    list: (): Promise<
      Array<{
        name: string;
        description: string;
        source: 'builtin' | 'user' | 'project' | 'plugin';
        path: string;
      }>
    > => ipcRenderer.invoke('skills:list'),
    body: (args: { path: string }): Promise<string> => ipcRenderer.invoke('skills:body', args),
  },

  agent: {
    start: (args: {
      sessionId: string;
      userMessage: string;
      mode?: string;
      model?: string;
      allowedTools?: string[];
    }): Promise<{ turnId: string }> => ipcRenderer.invoke('agent:start', args),
    abort: (args: { turnId: string }): Promise<boolean> =>
      ipcRenderer.invoke('agent:abort', args),
    approve: (args: { turnId: string; toolCallId: string; allow: boolean }): Promise<void> =>
      ipcRenderer.invoke('agent:approve', args),
    answer: (args: { turnId: string; questionId: string; answer: string }): Promise<void> =>
      ipcRenderer.invoke('agent:answer', args),
    onEvent: (cb: (e: unknown) => void): (() => void) => {
      const listener = (_event: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on('agent:event', listener);
      return () => ipcRenderer.removeListener('agent:event', listener);
    },
  },

  /** Subscribe to "update downloaded" events from the auto-updater. */
  onUpdateDownloaded: (
    cb: (info: { version: string; releaseNotes?: string }) => void,
  ): (() => void) => {
    const listener = (_e: unknown, info: { version: string; releaseNotes?: string }) =>
      cb(info);
    ipcRenderer.on('updater:update-downloaded', listener);
    return () => ipcRenderer.removeListener('updater:update-downloaded', listener);
  },
};

contextBridge.exposeInMainWorld('deepcode', api);

export type DeepCodeRendererAPI = typeof api;
