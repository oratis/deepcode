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
  TodoWriteTool,
  WebFetchTool,
  WebSearchTool,
  readTodos,
  TODO_FILE,
  parseDuckDuckGoHtml,
  ToolRegistry,
  BUILTIN_TOOLS,
  type TodoItem,
  type TodoStatus,
  type SearchHit,
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

// Credentials (M2; M3c adds ApiKeyHelperRefresher)
export {
  CredentialsStore,
  resolveCredentials,
  ApiKeyHelperRefresher,
  redact,
  type Credentials,
  type CredentialsStoreOpts,
  type ApiKeyHelperOpts,
} from './credentials/index.js';

// Mode policy (M3)
export {
  evaluateMode,
  modeVerdictReason,
  type ModeRequest,
  type ModeVerdict,
} from './modes/index.js';

// Hooks (M3 — command handler only; http/mcp_tool/prompt/agent → M5+)
export {
  HookDispatcher,
  runCommand,
  tryParseJsonOutput,
  type HookContext,
  type HookHandlerOutput,
  type HookResult,
  type HookRegistration,
  type HookDispatcherOpts,
} from './hooks/index.js';

// Memory (M3 — dual-system + @-import + AGENTS.md + rules dir)
export {
  loadMemory,
  walkUpwards,
  type MemorySource,
  type LoadedMemory,
  type LoadMemoryOpts,
} from './memory/index.js';

// Harness (M3b — tool dispatcher gates; M3c — statusLine runner)
export {
  dispatchToolCall,
  StatusLineRunner,
  runStatusLineCommand,
  type DispatchRequest,
  type DispatchVerdict,
  type StatusLineRunnerOpts,
  type StatusLinePayload,
} from './harness/index.js';

// Compaction (M3c)
export {
  compact,
  shouldCompact,
  type CompactionOpts,
  type CompactionResult,
} from './compaction/index.js';

// Agent loop's approval callback type (M3b)
export type { ApprovalCallback } from './agent.js';

// Skills (M4 — SKILL.md frontmatter loading + system-prompt builder; M5 — Skill tool)
export {
  loadSkills,
  buildSkillsDescriptionBlock,
  parseFrontmatter,
  parseSimpleYaml,
  makeSkillTool,
  type Skill,
  type SkillFrontmatter,
  type LoadSkillsOpts,
  type Frontmatter,
} from './skills/index.js';

// Sandbox (M3.5 — macOS sandbox-exec + Linux bwrap)
export {
  wrapBashCommand,
  buildMacOsProfile,
  buildLinuxBwrapArgs,
  detectPlatform,
  type SandboxPlatform,
  type SandboxedCommand,
} from './sandbox/index.js';

// MCP client (M3c — stdio transport; http/sse/OAuth/serve → M3c-ext)
export {
  connectMcpServer,
  connectAllMcpServers,
  closeAllMcpServers,
  type McpClientHandle,
  type McpToolMeta,
  type ConnectAllResult,
} from './mcp/index.js';

// Plugins (M5 — manifest + hash pin; M5.1 — subprocess runtime + RPC bridge;
// M5.2 — live registry wireup)
export {
  installLocal,
  discoverPlugins,
  readManifest,
  computeSourceHash,
  loadTrustState,
  saveTrustState,
  pluginsDir,
  trustFilePath,
  PluginSubprocess,
  spawnAllPlugins,
  shutdownAllPlugins,
  generatePluginToken,
  wirePlugins,
  hasInstalledPlugins,
  type PluginManifest,
  type InstalledPlugin,
  type PluginTrust,
  type TrustState,
  type InstallOptions,
  type DiscoverOptions,
  type RpcRequest,
  type RpcResponse,
  type PluginSubprocessOpts,
  type SpawnAllOpts,
  type WirePluginsOpts,
  type WiredPlugin,
  type WireResult,
  type PluginCapabilityBridge,
} from './plugins/index.js';

// Sub-agents (M4 — .deepcode/agents/*.md)
export {
  loadSubAgents,
  findSubAgent,
  type SubAgent,
  type SubAgentFrontmatter,
  type LoadSubAgentsOpts,
} from './sub-agents/index.js';

// Output styles (M4 — 4 built-in + custom)
export {
  loadOutputStyles,
  findStyle,
  applyStyle,
  BUILTIN_STYLES,
  type OutputStyle,
  type OutputStyleFrontmatter,
  type LoadOutputStylesOpts,
} from './output-styles/index.js';
