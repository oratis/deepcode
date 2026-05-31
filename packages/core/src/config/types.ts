// settings.json schema — DeepCode runtime config.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9
// Note: M2 implements the core fields. Many fields are placeholders until later milestones consume them.

import type { Effort, Mode } from '../types.js';

export interface PermissionRules {
  defaultMode?: Mode;
  allow?: string[]; // patterns like "Bash(npm test:*)" or "Read(./**)"
  ask?: string[];
  deny?: string[];
  additionalDirectories?: string[];
}

export interface HookHandler {
  type: 'command' | 'http' | 'mcp_tool' | 'prompt' | 'agent';
  command?: string;
  url?: string;
  headers?: Record<string, string>;
  server?: string;
  tool?: string;
  prompt?: string;
  agent?: string;
  timeout?: number;
  if?: string; // permission-rule-syntax filter
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookHandler[];
}

export type HookEventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact'
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'Notification';

export type Hooks = Partial<Record<HookEventName, HookMatcher[]>>;

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: 'stdio' | 'http' | 'sse';
  headers?: Record<string, string>;
  headersHelper?: string;
  alwaysLoad?: boolean;
  /**
   * Authenticate to an http/sse server via OAuth 2.0 (authorization-code +
   * PKCE, with dynamic client registration). On first connect this opens the
   * browser; tokens persist under ~/.deepcode/mcp-auth/<server>.json and
   * auto-refresh thereafter. Ignored for stdio servers.
   */
  oauth?: boolean;
  /** OAuth scopes to request (space-joined into the authorization request). */
  oauthScopes?: string[];
}

export interface StatusLineConfig {
  type: 'command';
  command: string;
}

export interface SandboxConfig {
  enabled?: boolean;
  filesystem?: {
    allowWrite?: string[];
    denyWrite?: string[];
    allowRead?: string[];
    denyRead?: string[];
  };
  network?: {
    allowedDomains?: string[];
    deniedDomains?: string[];
    allowUnixSockets?: boolean;
    allowLocalBinding?: boolean;
  };
  excludedCommands?: string[];
}

export interface UpdateConfig {
  channel?: 'stable' | 'beta' | 'nightly';
  checkIntervalHours?: number;
  autoDownload?: boolean;
  autoInstallOnQuit?: boolean;
}

export interface WorktreeConfig {
  baseRef?: string;
  symlinkDirectories?: string[];
  sparsePaths?: string[];
  bgIsolation?: boolean;
}

export interface AutoModeConfig {
  allow?: string[];
  soft_deny?: string[];
  hard_deny?: string[];
  model?: string;
  fallback?: 'ask' | 'deny';
}

export interface DeepCodeSettings {
  // Identity
  model?: string;
  baseURL?: string;
  apiKeyHelper?: string;

  // Permissions / modes
  permissions?: PermissionRules;
  autoMode?: AutoModeConfig;

  // Env passed to Bash subprocesses + hooks
  env?: Record<string, string>;

  // Hooks
  hooks?: Hooks;
  disableAllHooks?: boolean;
  allowedHttpHookUrls?: string[];
  httpHookAllowedEnvVars?: string[];

  // MCP
  mcpServers?: Record<string, McpServerConfig>;
  enableAllProjectMcpServers?: boolean;
  enabledMcpjsonServers?: string[];
  disabledMcpjsonServers?: string[];

  // Status line
  statusLine?: StatusLineConfig;

  // Misc
  includeCoAuthoredBy?: boolean;
  cleanupPeriodDays?: number;
  alwaysThinkingEnabled?: boolean;
  forceLoginMethod?: string;
  effortLevel?: Effort;
  effortBudgets?: Record<Effort, { maxTurnYuan: number }>;
  effortOverrides?: Record<string, Effort>;
  outputStyle?: string;
  language?: string;
  viewMode?: 'compact' | 'expanded';
  tui?: { vim?: boolean; spinnerTipsEnabled?: boolean; spinnerVerbs?: boolean };
  memoryLoadCapKB?: number;
  deepcodeMdExcludes?: string[];
  attribution?: boolean;
  prUrlTemplate?: string;
  includeGitInstructions?: boolean;
  feedbackSurveyRate?: number;
  awaySummaryEnabled?: boolean;
  preferredNotifChannel?: 'system' | 'terminal' | 'none';

  // Sandbox
  sandbox?: SandboxConfig;

  // Updates
  update?: UpdateConfig;

  // Worktree
  worktree?: WorktreeConfig;

  // Plugins (M5)
  plugins?: {
    globalEnabled?: boolean;
    allowedSources?: Array<
      | 'official'
      | 'verified-third-party'
      | 'unverified-marketplace'
      | 'direct-source'
      | 'local-path'
    >;
    requireMarketplace?: boolean;
    autoUpdate?: boolean;
    maxPlugins?: number;
  };
  disabledPlugins?: string[];

  // Tool-level config (e.g. alwaysLoad opt-out)
  tools?: Record<string, { alwaysLoad?: boolean }>;
  skillOverrides?: Record<string, { disabled?: boolean }>;
}
