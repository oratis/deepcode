// Compatibility shim — installs window.deepcode backed by Tauri.
// Keeps the existing React screens working after the Electron → Tauri pivot.
// Canonical type lives in src/types/global.d.ts (DeepCodeAPI).

import type { DeepCodeAPI } from '../types/global.js';
import {
  getAppInfo,
  listSessions,
  loadSettingsFile,
  openUrl,
  readCredentials,
  saveCredentials,
} from './tauri-api.js';

export function installTauriShim(): void {
  const api: DeepCodeAPI = {
    async version() {
      const info = await getAppInfo();
      return info.version;
    },
    creds: {
      async load() {
        const c = await readCredentials();
        return { hasKey: !!(c.apiKey || c.authToken), baseURL: c.baseURL };
      },
      async save({ apiKey, baseURL }) {
        await saveCredentials({ apiKey, baseURL });
        return true;
      },
    },
    settings: {
      load() {
        return loadSettingsFile();
      },
    },
    sessions: {
      async list() {
        const rows = await listSessions();
        return rows.map((r) => ({
          id: r.id,
          cwd: '',
          updatedAt: new Date(r.updated_at_secs * 1000).toISOString(),
        }));
      },
      async resume() {
        return { history: [], sessionId: '' };
      },
    },
    plugins: {
      async list() { return []; },
      async install() { return { name: '', version: '' }; },
      async setEnabled() { return false; },
    },
    mcp: { async list() { return []; } },
    skills: {
      async list() { return []; },
      async body() { return ''; },
    },
    agent: {
      async start({ userMessage }) {
        void userMessage;
        return { turnId: `local-${Date.now()}` };
      },
      async abort() { return false; },
      async approve() {},
      async answer() {},
      onEvent() { return () => {}; },
    },
    onUpdateDownloaded() { return () => {}; },
    openUrl(url: string) { return openUrl(url); },
  };
  window.deepcode = api;
}
