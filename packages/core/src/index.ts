// @deepcode/core — kernel for DeepCode
// See docs/DEVELOPMENT_PLAN.md §3 for module structure.
// M1 surface: DeepSeekProvider + agent loop + 6 P0 tools + sessions

// The string `deepcode --version`, `--help`, `/upgrade` and `/bug` all print.
// Kept in lockstep with apps/cli/package.json by scripts/version-consistency.test.ts,
// and rewritten from the tag by .github/workflows/release.yml at publish time —
// before this it stayed at 0.1.0 while the CLI shipped as 0.1.6.
export const VERSION = '0.3.0';
export const PROJECT_NAME = 'DeepCode';

// Types
export type * from './types.js';

// Providers
export {
  DeepSeekProvider,
  DEEPSEEK_MODELS,
  DEFAULT_CONTEXT_WINDOW,
  EFFORT_PARAMS,
  contextWindowFor,
  estimateCost,
  type CostBreakdown,
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
  AskUserQuestionTool,
  SubmitReviewFindingTool,
  RestoreReviewActionTool,
  ExitPlanModeTool,
  makeToolSearchTool,
  installToolSearch,
  RegistryDeferredStore,
  type DeferredToolEntry,
  type DeferredToolStore,
  readTodos,
  TODO_FILE,
  parseDuckDuckGoHtml,
  ToolRegistry,
  BUILTIN_TOOLS,
  type TodoItem,
  type TodoStatus,
  type SearchHit,
  type ReviewFinding,
} from './tools/index.js';

// Sessions
export {
  SessionManager,
  defaultSessionsDir,
  newSessionId,
  readSessionRecords,
  SessionCorruptionError,
  SessionWriterConflictError,
  captureSnapshot,
  captureGitCheckpoint,
  listSnapshots,
  restoreSnapshot,
  type SessionMeta,
  type SessionFiles,
  type SessionManagerOpts,
  type SessionDiagnostic,
  type SessionFormat,
  type SessionReadResult,
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
  appendAllowMatcher,
  gateUntrustedSettings,
  HookTrustStore,
  hookDefinitionHash,
  TRUST_GATED_FIELDS,
  evaluatePermission,
  matchRule,
  parseRule,
  primaryInput,
  type DeepCodeSettings,
  type PermissionRules,
  type LoadedSettings,
  type LoadSettingsOpts,
  type TrustStatus,
  type TrustGatedField,
  type GateResult,
  type HookReview,
  type PermissionVerdict,
  type PermissionRequest,
  type Hooks,
  type HookHandler,
  type HookMatcher,
  type HookEventName,
  type McpServerConfig,
  type StatusLineConfig,
  type SandboxConfig,
  type SandboxMode,
  type UpdateConfig,
  type WorktreeConfig,
  type AutoModeConfig,
  type VoiceConfig,
} from './config/index.js';

// File contract — path-axis permission rules (plan §2.A)
export {
  evaluatePath,
  globMatches,
  normalizeContractPath,
  parseFileContract,
  contractNeedsSandbox,
  fileContractPaths,
  loadFileContract,
  DEFAULT_CONTRACT_DEFAULTS,
  FileContractError,
  RECOMMENDED_FILE_CONTRACT,
  type ContractAction,
  type ContractDecision,
  type ContractEvaluation,
  type ContractOwner,
  type ContractRequest,
  type FileContract,
  type FileContractRule,
  type FileContractStatus,
  type LoadedFileContract,
  contractGovernedTools,
  evaluateContract,
  fileContractWarnings,
  mostRestrictive,
  withheldNotice,
  withholdDeniedReads,
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
  isPermissiveMode,
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
  rememberFact,
  projectMemoryPath,
  projectMemoryKey,
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

// Tool-output spill — the central bound on model-visible tool output.
export {
  applySpillPolicy,
  boundText,
  BoundedCapture,
  DEFAULT_SPILL_THRESHOLD_CHARS,
  type BoundedText,
  type SaveTextRequest,
  type SpillOutcome,
  type SpillPolicyOptions,
  type SpillRef,
  type SpillSource,
  type SpillStore,
} from './spill/index.js';
// Loop-hygiene guards
export {
  RepeatToolGuard,
  DEFAULT_REPEAT_EXCLUDE,
  type RepeatGuardOptions,
  type RepeatReminder,
  type RepeatReminderKind,
} from './guard/index.js';

// Agent loop's approval callback type (M3b)
export type { ApprovalCallback, ApprovalDecision } from './agent.js';

// Runtime safety policy shared by non-interactive hosts.
export {
  SAFE_DEFAULT_PERMISSIONS,
  SAFE_READONLY_TOOLS,
  RuntimeHost,
  createRuntimeHost,
  resolveRuntimePolicy,
  type RuntimeHostOptions,
  type RuntimeTurnOptions,
  type RuntimePolicyInput,
} from './runtime/index.js';

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

// Sandbox (M3.5 — macOS sandbox-exec + Linux bwrap; M3.5-ext — slirp4netns
// selective per-domain network allowlist)
export {
  wrapBashCommand,
  buildMacOsProfile,
  buildLinuxBwrapArgs,
  detectPlatform,
  spawnNetworkSandbox,
  needsNetworkSandbox,
  denyAllNetwork,
  NetworkSandboxUnavailable,
  startDnsProxy,
  withAdditionalWritableDirs,
  SANDBOX_MODES,
  isSandboxMode,
  resolveSandboxMode,
  sandboxConfigForMode,
  describeSandboxMode,
  withSandboxMode,
  type SandboxPlatform,
  type SandboxedCommand,
  type SpawnNetworkSandboxOpts,
  type NetworkSandboxHandle,
  type DnsProxyHandle,
} from './sandbox/index.js';

// MCP client (M3c — stdio transport; http/sse → M3c-ext) + server (`mcp serve`)
export {
  connectMcpServer,
  connectAllMcpServers,
  closeAllMcpServers,
  buildMcpServer,
  buildMcpGate,
  serveMcpOverStdio,
  mcpServableTools,
  MCP_SERVE_EXCLUDE,
  readMcpResource,
  parseResourceRefs,
  expandMcpResourceRefs,
  getMcpPrompt,
  mcpPromptCommands,
  resolveMcpPromptInvocation,
  McpAuthStore,
  createMcpOAuthProvider,
  startLoopbackReceiver,
  mcpAuthPath,
  type McpClientHandle,
  type McpToolMeta,
  type McpResourceMeta,
  type McpResourceTemplateMeta,
  type McpPromptMeta,
  type ConnectAllResult,
  type BuildMcpServerOpts,
  type ServeMcpStdioOpts,
  type ResourceRef,
  type ExpandResourcesResult,
  type McpPromptCommand,
  type McpElicitRequest,
  type McpElicitResult,
  type McpElicitHandler,
  type ConnectMcpOpts,
} from './mcp/index.js';

// Plugins (M5 — manifest + hash pin; M5.1 — subprocess runtime + RPC bridge;
// M5.2 — live registry wireup)
export {
  installLocal,
  discoverPlugins,
  collectPluginContributions,
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
  installFromGithub,
  installFromNpm,
  installFromSpec,
  uninstallPlugin,
  verifyEntrySignature,
  isRevoked,
  fetchIndex,
  fetchRevoked,
  resolveEntry,
  loadMarketplaceConfig,
  saveMarketplaceConfig,
  addMarketplace,
  marketplacesPath,
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
  type RemoteInstallOpts,
  type MarketplaceEntry,
  type MarketplaceIndex,
  type RevokedEntry,
  type RevokedList,
  type MarketplaceConfig,
} from './plugins/index.js';

// Settings JSON schema + shallow validator (v1.1)
export {
  settingsSchemaJson,
  settingsSchemaObject,
  validateSettingsShallow,
} from './config/schema.js';

export {
  DirectoryTrustStore,
  diagnoseSettings,
  type DirectoryTrustState,
  type DirectoryTrustStoreOptions,
  type DiagnoseSettingsOptions,
  type SettingsDiagnostics,
} from './config/index.js';

// Vision (v1.1 — image input abstraction)
export {
  StubVisionProvider,
  OpenAICompatVisionProvider,
  loadImage,
  parseDataUrl,
  guessContentType,
  type VisionProvider,
  type ImageContentBlock,
  type ProviderImagePayload,
} from './vision/index.js';

// Background tasks (M3.15.3 — TaskCreate family + Monitor)
export {
  TaskManager,
  type Task,
  type TaskStatus,
  type TaskRunner,
  type TaskRunHandle,
  type CreateTaskSpec,
} from './tasks/manager.js';

// Voice input (M8 — whisper.cpp wrapper + stub provider + setup detection)
export {
  WhisperCppProvider,
  StubVoiceProvider,
  parseWhisperOutput,
  detectVoice,
  detectRecorder,
  recordToWav,
  buildRecordArgs,
  type VoiceProvider,
  type VoiceTranscript,
  type TranscribeOpts,
  type WhisperCppOpts,
  type VoiceProbe,
  type VoiceStatus,
  type RecorderBin,
  type RecorderStatus,
  type RecordToWavOpts,
} from './voice/index.js';

// Auto-mode classifier (M3c-rest — LLM-judged tool gate when mode === 'auto')
export { classifyAutoMode, type AutoVerdict, type ClassifyOpts } from './auto-mode/index.js';

// Worktree (M8 — isolated git worktree creation for background tasks)
export {
  createWorktree,
  removeWorktree,
  type WorktreeHandle,
  type CreateWorktreeOpts,
} from './worktree/index.js';

// Scrubbed environment for spawning `git` against an explicit cwd (strips
// inherited GIT_* so a leaked GIT_DIR can't redirect the call).
export { gitSpawnEnv } from './util/git-env.js';
export { computeLineDiff, hasChanges, type DiffLine } from './util/diff.js';

// launchd LaunchAgent installer (M8 — macOS scheduled tasks daemon)
export {
  buildPlist,
  installPlist,
  uninstallPlist,
  launchdPlistPath,
  LAUNCHD_LABEL,
  type LaunchdInstallOpts,
} from './launchd/index.js';

// Cron — scheduled headless agent runs (CronCreate/List/Delete + scheduler daemon)
export {
  cronStorePath,
  loadCronStore,
  saveCronStore,
  addCronJob,
  removeCronJob,
  listCronJobs,
  validateCronExpr,
  isCronDue,
  dueJobs,
  dueJobsWithTriggers,
  describeTrigger,
  isTriggerDue,
  matchingEvents,
  occursAt,
  parseIcs,
  resolveTrigger,
  validateTrigger,
  resolveUnattendedApproval,
  describeClamp,
  resolveTriggerMode,
  tightenPermissions,
  tightenSandbox,
  type ResolvedTriggerMode,
  type TriggerProfile,
  type CronJob,
  type CronStore,
  type DueJob,
  type IcsCalendar,
  type IcsEvent,
  type IcsRecurrence,
  type TriggerContext,
  type TriggerSource,
  type TriggerVerdict,
  type UnattendedApprovalPolicy,
} from './cron/index.js';

// Keybindings (M8 — ~/.deepcode/keybindings.json + Vim mode state machine)
export {
  DEFAULT_KEYBINDINGS,
  loadKeybindings,
  saveKeybindings,
  keybindingsPath,
  resolveKeyAction,
  normalizeChord,
  VimState,
  type KeyBinding,
  type KeybindingsConfig,
  type VimMode,
  type KeyResolveOpts,
} from './keybindings/index.js';

// System reminders (M3c-rest — date / cwd / todos / external file mods / AGENTS.md missing)
export {
  buildSystemReminders,
  prependReminders,
  dateReminder,
  cwdReminder,
  agentsMdMissingReminder,
  todosPendingReminder,
  externalFileModifiedReminder,
  type ReminderContext,
  type ReminderOptions,
  type ReminderType,
} from './reminders/index.js';

// Sub-agents (M4 — .deepcode/agents/*.md)
export {
  loadSubAgents,
  findSubAgent,
  type SubAgent,
  type SubAgentFrontmatter,
  type LoadSubAgentsOpts,
} from './sub-agents/index.js';

// Custom slash commands (.deepcode/commands/*.md — prompt templates)
export {
  loadSlashCommands,
  findCustomCommand,
  expandCommandBody,
  type CustomCommand,
  type LoadSlashCommandsOpts,
} from './slash-commands/index.js';

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

// Change ledger — append-only audit of workspace mutations (plan §2.B)
export {
  FileLedger,
  DEFAULT_RETENTION,
  LEDGER_KINDS,
  findLedgerRecord,
  ledgerPath,
  newLedgerId,
  projectLedgerDir,
  readLedger,
  readProjectLedger,
  renderLedgerMarkdown,
  type LedgerKind,
  type LedgerRecord,
  type LedgerRetention,
  type LedgerSink,
  type NewLedgerRecord,
  type RollbackHint,
} from './ledger/index.js';
export {
  buildToolCallRecord,
  isRecordableTool,
  ledgerKindForTool,
  type ToolCallRecordInput,
} from './ledger/record-tool-call.js';

// No Silent Apply ceremony (plan §2.F)
export {
  applyWithCeremony,
  renderApplyPresentation,
  type ApplyConfirm,
  type ApplyDecision,
  type ApplyExplanation,
  type ApplyOutcome,
  type ApplyPlan,
  type ApplyPresentation,
} from './runtime/apply-ceremony.js';
export { planRollback, type RollbackContext, type RollbackPlanResult } from './ledger/rollback.js';

// Runtime capability declaration (plan §2.C)
export {
  ALWAYS_CONFIRMED_ACTIONS,
  buildRuntimeCapabilities,
  type BuildRuntimeCapabilitiesInput,
  type RuntimeCapabilities,
} from './runtime/capabilities.js';

// Combo — distil a finished thread into a SKILL.md draft (plan §2.D)
export {
  distillSkill,
  sanitizeSkillName,
  type DistilledSkill,
  type DistillOpts,
} from './skills/index.js';
