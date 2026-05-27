// @deepcode/core — kernel for DeepCode
// See docs/DEVELOPMENT_PLAN.md §3 for module structure.
// M1 surface: DeepSeekProvider + agent loop + 6 P0 tools + sessions

export const VERSION = '0.1.0';
export const PROJECT_NAME = 'DeepCode';

// Types
export type * from './types.js';

// Providers
export {
  DeepSeekProvider,
  DEEPSEEK_MODELS,
  EFFORT_PARAMS,
  type DeepSeekProviderOpts,
  type Provider,
  type ProviderResult,
  type ProviderRunOpts,
  type ProviderUsage,
  type ProviderStreamHandlers,
} from './providers/index.js';

// Tools
export {
  ReadTool,
  WriteTool,
  EditTool,
  BashTool,
  GrepTool,
  GlobTool,
  ToolRegistry,
  BUILTIN_TOOLS,
} from './tools/index.js';

// Sessions
export {
  SessionManager,
  defaultSessionsDir,
  newSessionId,
  captureSnapshot,
  listSnapshots,
  restoreSnapshot,
  type SessionMeta,
  type SessionFiles,
  type SessionManagerOpts,
  type Snapshot,
} from './sessions/index.js';

// Agent loop
export { runAgent, AGENT_MODULE_VERSION } from './agent.js';
export type { RunAgentOptions, RunAgentResult } from './agent.js';

// Config + Permissions (M2)
export {
  loadSettings,
  writeSettings,
  settingsPaths,
  deepMerge,
  evaluatePermission,
  matchRule,
  parseRule,
  primaryInput,
  type DeepCodeSettings,
  type PermissionRules,
  type LoadedSettings,
  type LoadSettingsOpts,
  type PermissionVerdict,
  type PermissionRequest,
  type Hooks,
  type HookHandler,
  type HookMatcher,
  type HookEventName,
  type McpServerConfig,
  type StatusLineConfig,
  type SandboxConfig,
  type UpdateConfig,
  type WorktreeConfig,
  type AutoModeConfig,
} from './config/index.js';

// Credentials (M2)
export {
  CredentialsStore,
  resolveCredentials,
  redact,
  type Credentials,
  type CredentialsStoreOpts,
} from './credentials/index.js';
