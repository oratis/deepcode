// Compatibility shim — installs window.deepcode backed by Tauri.
// Keeps the existing React screens working after the Electron → Tauri pivot.
// Canonical type lives in src/types/global.d.ts (DeepCodeAPI).

import type { DeepCodeAPI } from '../types/global.js';
import { loadProjectPath } from './project.js';
import {
  abortProtocolTurn,
  answerProtocolRequest,
  approveProtocolRequest,
  installProtocolAgentEmitter,
  resumeProtocolThread,
  startProtocolTurn,
} from './protocol-agent.js';
import {
  credentialStatus,
  getAppInfo,
  listPlugins,
  listSessions,
  listSkills,
  loadSettingsFile,
  openUrl,
  saveCredentials,
  sessionRead,
} from './tauri-api.js';

// In-memory event bus: every agent.start() call ID maps to an array of
// listeners. We fan out stable protocol projections to every listener.
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
  installProtocolAgentEmitter(emitEvent);
  const api: DeepCodeAPI = {
    async version() {
      const info = await getAppInfo();
      return info.version;
    },
    creds: {
      async load() {
        return credentialStatus();
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
          title: r.title,
          cwd: '',
          updatedAt: new Date(r.updated_at_secs * 1000).toISOString(),
        }));
      },
      async resume({ id }) {
        await resumeProtocolThread(id);
        const lines = await sessionRead(id);
        const history = lines.map((l) => ({
          role: l.role,
          content: l.content,
          timestamp: l.timestamp ?? '',
        })) as unknown as import('@deepcode/core/dist/types.js').StoredMessage[];
        return { history, sessionId: id };
      },
    },
    plugins: {
      async list() {
        // Reads ~/.deepcode/plugins via the list_plugins Rust command (the
        // renderer can't run core's node:fs discoverPlugins).
        try {
          return await listPlugins();
        } catch {
          return [];
        }
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
        // Read the servers configured in settings.json#mcpServers. The desktop
        // MVP doesn't spawn MCP servers itself (the CLI does), so they show as
        // "configured" rather than live-connected.
        try {
          const s = (await loadSettingsFile()) as { mcpServers?: Record<string, unknown> };
          return Object.keys(s.mcpServers ?? {}).map((name) => ({
            name,
            status: 'disabled' as const,
          }));
        } catch {
          return [];
        }
      },
    },
    skills: {
      async list() {
        // Built-in (bundled .app resource) + user + project skills via the
        // list_skills Rust command. Project skills need the picked project dir.
        try {
          const cwd = await loadProjectPath();
          return await listSkills(cwd);
        } catch {
          return [];
        }
      },
      async body({ path }: { path: string }) {
        // list_skills already returns each skill's body; find by SKILL.md path.
        try {
          const cwd = await loadProjectPath();
          const found = (await listSkills(cwd)).find((s) => s.path === path);
          return found?.body ?? '';
        } catch {
          return '';
        }
      },
    },
    agent: {
      async start({ userMessage, model, mode, effort, cwd }) {
        const result = await startProtocolTurn({
          userMessage,
          model,
          mode,
          cwd,
          effort,
        });
        return { turnId: result.turnId, sessionId: result.threadId };
      },
      async abort({ turnId }) {
        return abortProtocolTurn(turnId);
      },
      async approve({ requestId, decision }) {
        await approveProtocolRequest(requestId, decision);
      },
      async answer({ requestId, answer }) {
        await answerProtocolRequest(requestId, answer);
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
