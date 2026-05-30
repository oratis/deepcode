// Compatibility shim — installs window.deepcode backed by Tauri.
// Keeps the existing React screens working after the Electron → Tauri pivot.
// Canonical type lives in src/types/global.d.ts (DeepCodeAPI).

import type { AgentEvent, Mode } from '@deepcode/core/dist/types.js';
import type { DeepCodeAPI } from '../types/global.js';
import { abortAgentTurn, clearHistory, resumeSession, startAgentTurn } from './mac-agent.js';
import {
  appendAllowMatcher,
  getAppInfo,
  listSessions,
  loadSettingsFile,
  openUrl,
  readCredentials,
  saveCredentials,
  sessionRead,
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

// Approval round-trips: mac-agent calls onApproval with a promise; we emit
// a `permission_request` event carrying a unique requestId and stash the
// resolver here. The UI calls api.agent.approve({ requestId, decision })
// which pops the resolver and resolves the original promise.
const pendingApprovals = new Map<string, (decision: 'allow' | 'deny' | 'always') => void>();

function nextRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
      async resume({ id }) {
        // Read the session's stored messages and adopt them into the agent so
        // the conversation continues with full context + appends to this file.
        const lines = await sessionRead(id);
        const history = lines.map((l) => ({
          role: l.role,
          content: l.content,
          timestamp: l.timestamp ?? '',
        })) as unknown as import('@deepcode/core/dist/types.js').StoredMessage[];
        resumeSession(id, history);
        return { history, sessionId: id };
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
      async start({ userMessage, model, mode, effort, cwd }) {
        // Pre-allocate turn ID so onEvent callbacks can reference it
        // without waiting for the promise to resolve.
        let pendingTurnId = `pending-${Date.now()}`;
        const result = await startAgentTurn({
          userMessage,
          model,
          mode: mode as Mode | undefined,
          cwd,
          effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined,
          onEvent: (e: AgentEvent) => emitEvent({ kind: 'event', turnId: pendingTurnId, ...e }),
          onDone: (reason) =>
            emitEvent({ kind: 'turn_done', turnId: pendingTurnId, stopReason: reason }),
          onApproval: (toolName, reason) => {
            // Mint a request ID, emit it as a synthetic event, and return
            // a promise the UI resolves via agent.approve().
            const requestId = nextRequestId();
            return new Promise<'allow' | 'deny' | 'always'>((resolve) => {
              pendingApprovals.set(requestId, resolve);
              emitEvent({
                kind: 'event',
                turnId: pendingTurnId,
                type: 'permission_request',
                requestId,
                toolName,
                reason,
              });
            });
          },
        });
        pendingTurnId = result.turnId;
        return result;
      },
      async abort({ turnId }) {
        return abortAgentTurn(turnId);
      },
      async approve({ requestId, decision }) {
        // Persistence note: when `decision === 'always'`, the caller is
        // expected to also have called `appendAllowMatcher(toolName)` so
        // the rule survives the next session. We don't do it here because
        // the shim no longer has access to the toolName by the time the
        // user decides. See ReplScreen.tsx where this is wired.
        const resolver = pendingApprovals.get(requestId);
        if (!resolver) return; // no-op if already resolved (e.g. stale click)
        pendingApprovals.delete(requestId);
        resolver(decision);
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
