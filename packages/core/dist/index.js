// @deepcode/core — kernel for DeepCode
// See docs/DEVELOPMENT_PLAN.md §3 for module structure.
// M1 surface: DeepSeekProvider + agent loop + 6 P0 tools + sessions
// The string `deepcode --version`, `--help`, `/upgrade` and `/bug` all print.
// Kept in lockstep with apps/cli/package.json by scripts/version-consistency.test.ts,
// and rewritten from the tag by .github/workflows/release.yml at publish time —
// before this it stayed at 0.1.0 while the CLI shipped as 0.1.6.
export const VERSION = '0.3.0';
export const PROJECT_NAME = 'DeepCode';
// Providers
export { DeepSeekProvider, DEEPSEEK_MODELS, DEFAULT_CONTEXT_WINDOW, EFFORT_PARAMS, contextWindowFor, estimateCost, } from './providers/index.js';
// Tools
export { ReadTool, WriteTool, EditTool, BashTool, GrepTool, GlobTool, TodoWriteTool, SessionSearchTool, SessionReadTool, SHELL_TOOLS, WebFetchTool, WebSearchTool, AskUserQuestionTool, SubmitReviewFindingTool, RestoreReviewActionTool, ExitPlanModeTool, makeToolSearchTool, installToolSearch, RegistryDeferredStore, readTodos, TODO_FILE, parseDuckDuckGoHtml, ToolRegistry, BUILTIN_TOOLS, presentToolCall, pickTarget, BUILTIN_RENDER_INTENTS, } from './tools/index.js';
// Sessions
export { SessionManager, defaultSessionsDir, newSessionId, readSessionRecords, SessionCorruptionError, SessionWriterConflictError, captureSnapshot, captureGitCheckpoint, listSnapshots, restoreSnapshot, searchSessions, inWorkspace, excerptAround, } from './sessions/index.js';
// Agent loop
export { runAgent, AGENT_MODULE_VERSION } from './agent.js';
// Config + Permissions (M2)
export { loadSettings, writeSettings, settingsPaths, deepMerge, appendAllowMatcher, gateUntrustedSettings, HookTrustStore, hookDefinitionHash, TRUST_GATED_FIELDS, evaluatePermission, matchRule, parseRule, primaryInput, } from './config/index.js';
// File contract — path-axis permission rules (plan §2.A)
export { evaluatePath, globMatches, normalizeContractPath, parseFileContract, contractNeedsSandbox, fileContractPaths, loadFileContract, DEFAULT_CONTRACT_DEFAULTS, FileContractError, RECOMMENDED_FILE_CONTRACT, contractGovernedTools, evaluateContract, fileContractWarnings, mostRestrictive, withheldNotice, withholdDeniedReads, } from './config/index.js';
// Credentials (M2; M3c adds ApiKeyHelperRefresher)
export { CredentialsStore, resolveCredentials, ApiKeyHelperRefresher, redact, } from './credentials/index.js';
// Mode policy (M3)
export { evaluateMode, isPermissiveMode, modeVerdictReason, } from './modes/index.js';
// Hooks (M3 — command handler only; http/mcp_tool/prompt/agent → M5+)
export { HookDispatcher, runCommand, tryParseJsonOutput, } from './hooks/index.js';
// Memory (M3 — dual-system + @-import + AGENTS.md + rules dir)
export { loadMemory, walkUpwards, rememberFact, projectMemoryPath, projectMemoryKey, } from './memory/index.js';
// Harness (M3b — tool dispatcher gates; M3c — statusLine runner)
export { dispatchToolCall, StatusLineRunner, runStatusLineCommand, } from './harness/index.js';
// Compaction (M3c)
export { compact, shouldCompact, } from './compaction/index.js';
// Tool-output spill — the central bound on model-visible tool output.
export { applySpillPolicy, boundText, BoundedCapture, DEFAULT_SPILL_THRESHOLD_CHARS, } from './spill/index.js';
// Loop-hygiene guards
export { RepeatToolGuard, DEFAULT_REPEAT_EXCLUDE, resolveToolDeadlineMs, deadlineMessage, DEFAULT_TOOL_DEADLINE_MS, SIDE_EFFECTING_TOOLS, } from './guard/index.js';
// Persistent shells
export { PersistentShell, ShellRegistry, } from './shell/index.js';
// Runtime safety policy shared by non-interactive hosts.
export { SAFE_DEFAULT_PERMISSIONS, SAFE_READONLY_TOOLS, RuntimeHost, createRuntimeHost, resolveRuntimePolicy, } from './runtime/index.js';
// Skills (M4 — SKILL.md frontmatter loading + system-prompt builder; M5 — Skill tool)
export { loadSkills, buildSkillsDescriptionBlock, parseFrontmatter, parseSimpleYaml, makeSkillTool, } from './skills/index.js';
// Sandbox (M3.5 — macOS sandbox-exec + Linux bwrap; M3.5-ext — slirp4netns
// selective per-domain network allowlist)
export { wrapBashCommand, buildMacOsProfile, buildLinuxBwrapArgs, detectPlatform, spawnNetworkSandbox, needsNetworkSandbox, denyAllNetwork, NetworkSandboxUnavailable, startDnsProxy, withAdditionalWritableDirs, SANDBOX_MODES, isSandboxMode, resolveSandboxMode, sandboxConfigForMode, describeSandboxMode, withSandboxMode, } from './sandbox/index.js';
// MCP client (M3c — stdio transport; http/sse → M3c-ext) + server (`mcp serve`)
export { connectMcpServer, connectAllMcpServers, closeAllMcpServers, buildMcpServer, buildMcpGate, serveMcpOverStdio, mcpServableTools, MCP_SERVE_EXCLUDE, readMcpResource, parseResourceRefs, expandMcpResourceRefs, getMcpPrompt, mcpPromptCommands, resolveMcpPromptInvocation, McpAuthStore, createMcpOAuthProvider, startLoopbackReceiver, mcpAuthPath, } from './mcp/index.js';
// Plugins (M5 — manifest + hash pin; M5.1 — subprocess runtime + RPC bridge;
// M5.2 — live registry wireup)
export { installLocal, discoverPlugins, collectPluginContributions, readManifest, computeSourceHash, loadTrustState, saveTrustState, pluginsDir, trustFilePath, PluginSubprocess, spawnAllPlugins, shutdownAllPlugins, generatePluginToken, wirePlugins, hasInstalledPlugins, installFromGithub, installFromNpm, installFromSpec, uninstallPlugin, verifyEntrySignature, isRevoked, fetchIndex, fetchRevoked, resolveEntry, loadMarketplaceConfig, saveMarketplaceConfig, addMarketplace, marketplacesPath, } from './plugins/index.js';
// Settings JSON schema + shallow validator (v1.1)
export { settingsSchemaJson, settingsSchemaObject, validateSettingsShallow, } from './config/schema.js';
export { DirectoryTrustStore, diagnoseSettings, } from './config/index.js';
// Vision (v1.1 — image input abstraction)
export { StubVisionProvider, OpenAICompatVisionProvider, loadImage, parseDataUrl, guessContentType, } from './vision/index.js';
// Background tasks (M3.15.3 — TaskCreate family + Monitor)
export { TaskManager, } from './tasks/manager.js';
// Voice input (M8 — whisper.cpp wrapper + stub provider + setup detection)
export { WhisperCppProvider, StubVoiceProvider, parseWhisperOutput, detectVoice, detectRecorder, recordToWav, buildRecordArgs, } from './voice/index.js';
// Auto-mode classifier (M3c-rest — LLM-judged tool gate when mode === 'auto')
export { classifyAutoMode } from './auto-mode/index.js';
// Worktree (M8 — isolated git worktree creation for background tasks)
export { createWorktree, removeWorktree, } from './worktree/index.js';
// Scrubbed environment for spawning `git` against an explicit cwd (strips
// inherited GIT_* so a leaked GIT_DIR can't redirect the call).
export { gitSpawnEnv } from './util/git-env.js';
export { computeLineDiff, hasChanges } from './util/diff.js';
// launchd LaunchAgent installer (M8 — macOS scheduled tasks daemon)
export { buildPlist, installPlist, uninstallPlist, launchdPlistPath, LAUNCHD_LABEL, } from './launchd/index.js';
// Cron — scheduled headless agent runs (CronCreate/List/Delete + scheduler daemon)
export { cronStorePath, loadCronStore, saveCronStore, addCronJob, removeCronJob, listCronJobs, validateCronExpr, isCronDue, dueJobs, dueJobsWithTriggers, describeTrigger, isTriggerDue, matchingEvents, occursAt, parseIcs, resolveTrigger, validateTrigger, resolveUnattendedApproval, describeClamp, resolveTriggerMode, tightenPermissions, tightenSandbox, } from './cron/index.js';
// Keybindings (M8 — ~/.deepcode/keybindings.json + Vim mode state machine)
export { DEFAULT_KEYBINDINGS, loadKeybindings, saveKeybindings, keybindingsPath, resolveKeyAction, normalizeChord, VimState, } from './keybindings/index.js';
// System reminders (M3c-rest — date / cwd / todos / external file mods / AGENTS.md missing)
export { buildSystemReminders, prependReminders, dateReminder, cwdReminder, agentsMdMissingReminder, todosPendingReminder, externalFileModifiedReminder, } from './reminders/index.js';
// Sub-agents (M4 — .deepcode/agents/*.md)
export { loadSubAgents, findSubAgent, } from './sub-agents/index.js';
// Custom slash commands (.deepcode/commands/*.md — prompt templates)
export { loadSlashCommands, findCustomCommand, expandCommandBody, } from './slash-commands/index.js';
// Output styles (M4 — 4 built-in + custom)
export { loadOutputStyles, findStyle, applyStyle, BUILTIN_STYLES, } from './output-styles/index.js';
// Change ledger — append-only audit of workspace mutations (plan §2.B)
export { FileLedger, DEFAULT_RETENTION, LEDGER_KINDS, findLedgerRecord, ledgerPath, newLedgerId, projectLedgerDir, readLedger, readProjectLedger, renderLedgerMarkdown, } from './ledger/index.js';
export { buildToolCallRecord, isRecordableTool, ledgerKindForTool, } from './ledger/record-tool-call.js';
// No Silent Apply ceremony (plan §2.F)
export { applyWithCeremony, renderApplyPresentation, } from './runtime/apply-ceremony.js';
export { planRollback } from './ledger/rollback.js';
// Runtime capability declaration (plan §2.C)
export { ALWAYS_CONFIRMED_ACTIONS, buildRuntimeCapabilities, } from './runtime/capabilities.js';
// Combo — distil a finished thread into a SKILL.md draft (plan §2.D)
export { distillSkill, sanitizeSkillName, } from './skills/index.js';
//# sourceMappingURL=index.js.map