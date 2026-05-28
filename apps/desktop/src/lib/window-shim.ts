// Compatibility shim — installs window.deepcode backed by Tauri.
// Keeps the existing React screens working after the Electron → Tauri pivot.
// Canonical type lives in src/types/global.d.ts (DeepCodeAPI).

import type { AgentEvent, Mode } from '@deepcode/core/dist/types.js';
import type { DeepCodeAPI } from '../types/global.js';
import { abortAgentTurn, startAgentTurn } from './mac-agent.js';
import {
  getAppInfo,
  listSessions,
  loadSettingsFile,
  openUrl,
  readCredentials,
  saveCredentials,
} from './tauri-api.js';

// In-memory event bus: every agent.start() call ID maps to an array of
// listeners. We fan-out the AgentEvents from mac-agent to every listener.
type Listener = (e: unknown) => void;
const listeners: Listener[] = [];

function emitEvent(e: unknown): void {
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      /* listeners are isolated */
    }
  }
}

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
      async list() {
        return [];
      },
      async install() {
        return { name: '', version: '' };
      },
      async setEnabled() {
        return false;
      },
    },
    mcp: {
      async list() {
        return [];
      },
    },
    skills: {
      async list() {
        return [];
      },
      async body() {
        return '';
      },
    },
    agent: {
      async start({ userMessage, model, mode }) {
        // Pre-allocate turn ID so onEvent callbacks can reference it
        // without waiting for the promise to resolve.
        let pendingTurnId = `pending-${Date.now()}`;
        const result = await startAgentTurn({
          userMessage,
          model,
          mode: mode as Mode | undefined,
          onEvent: (e: AgentEvent) =>
            emitEvent({ kind: 'event', turnId: pendingTurnId, ...e }),
          onDone: (reason) =>
            emitEvent({ kind: 'turn_done', turnId: pendingTurnId, stopReason: reason }),
        });
        pendingTurnId = result.turnId;
        return result;
      },
      async abort({ turnId }) {
        return abortAgentTurn(turnId);
      },
      async approve() {
        // Approval prompts are handled inline via the onApproval callback
        // passed to startAgentTurn — not via this method. Kept for API
        // shape compatibility.
      },
      async answer() {
        // AskUserQuestion answers: same — for v1 Mac MVP we don't wire
        // the inline askUser callback because the renderer doesn't yet
        // surface that UI.
      },
      onEvent(cb: (e: unknown) => void): () => void {
        listeners.push(cb);
        return () => {
          const i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
    },
    onUpdateDownloaded() {
      return () => {};
    },
    openUrl(url: string) {
      return openUrl(url);
    },
  };
  window.deepcode = api;
}
