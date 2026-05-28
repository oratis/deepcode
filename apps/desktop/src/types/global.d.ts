// Canonical renderer types. Window.deepcode is installed at runtime by
// src/lib/window-shim.ts (which uses Tauri's invoke() under the hood).

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

export interface SessionListEntry {
  id: string;
  title?: string;
  cwd: string;
  updatedAt: string;
  model?: string;
}

export interface PluginRow {
  name: string;
  version: string;
  enabled: boolean;
  sourceHash: string;
  trustedBy: 'user' | 'marketplace' | 'official';
  contributedHookEvents: string[];
}

export interface McpServerRow {
  name: string;
  status: 'connected' | 'failed' | 'disabled';
  toolCount?: number;
  error?: string;
}

export interface SkillRow {
  name: string;
  description: string;
  source: 'builtin' | 'user' | 'project' | 'plugin';
  path: string;
}

export interface DeepCodeAPI {
  version: () => Promise<string>;
  creds: {
    load: () => Promise<{ hasKey: boolean; baseURL?: string }>;
    save: (args: { apiKey: string; baseURL?: string }) => Promise<boolean>;
  };
  settings: {
    load: () => Promise<Record<string, unknown>>;
  };
  sessions: {
    list: (args?: { limit?: number }) => Promise<SessionListEntry[]>;
    resume: (args: { id: string }) => Promise<{ history: unknown[]; sessionId: string }>;
  };
  plugins: {
    list: () => Promise<PluginRow[]>;
    install: (args: { spec: string }) => Promise<{ name: string; version: string }>;
    setEnabled: (args: { name: string; enabled: boolean }) => Promise<boolean>;
  };
  mcp: {
    list: () => Promise<McpServerRow[]>;
  };
  skills: {
    list: () => Promise<SkillRow[]>;
    body: (args: { path: string }) => Promise<string>;
  };
  agent: {
    start: (args: {
      sessionId: string;
      userMessage: string;
      mode?: string;
      model?: string;
      /** 'low' | 'medium' | 'high' | 'xhigh' | 'max' — controls
       *  maxTokens + temperature. Defaults to 'medium'. */
      effort?: string;
      allowedTools?: string[];
    }) => Promise<{ turnId: string }>;
    abort: (args: { turnId: string }) => Promise<boolean>;
    /** Resolve an in-flight permission_request event. `decision === 'always'`
     *  also persists a matcher to ~/.deepcode/settings.json. */
    approve: (args: {
      requestId: string;
      decision: 'allow' | 'deny' | 'always';
    }) => Promise<void>;
    answer: (args: { turnId: string; questionId: string; answer: string }) => Promise<void>;
    onEvent: (cb: (e: unknown) => void) => () => void;
  };
  onUpdateDownloaded: (cb: (info: UpdateInfo) => void) => () => void;
  /** Tauri-only: open a URL in the user's default browser. */
  openUrl?: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    deepcode: DeepCodeAPI;
  }
}
export {};
