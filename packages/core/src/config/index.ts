// Config subsystem — settings.json loading + permission matcher.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9
// Milestone: M2

export type {
  DeepCodeSettings,
  PermissionRules,
  HookHandler,
  HookMatcher,
  HookEventName,
  Hooks,
  McpServerConfig,
  StatusLineConfig,
  SandboxConfig,
  UpdateConfig,
  WorktreeConfig,
  AutoModeConfig,
  VoiceConfig,
} from './types.js';

export {
  loadSettings,
  writeSettings,
  settingsPaths,
  deepMerge,
  appendAllowMatcher,
  type LoadedSettings,
  type LoadSettingsOpts,
  type SettingsLayerName,
  type SettingsValueSource,
} from './loader.js';

export {
  gateUntrustedSettings,
  TRUST_GATED_FIELDS,
  type TrustStatus,
  type TrustGatedField,
  type GateResult,
} from './trust-gate.js';

export {
  DirectoryTrustStore,
  type DirectoryTrustState,
  type DirectoryTrustStoreOptions,
} from './trust-store.js';

export {
  diagnoseSettings,
  type DiagnoseSettingsOptions,
  type SettingsDiagnostics,
  type SettingsDiagnosticIssue,
  type SettingsDiagnosticSeverity,
  type SettingsLayerDiagnostic,
} from './diagnostics.js';

export { validateSettingsShallow } from './validation.js';

export {
  evaluatePermission,
  matchRule,
  parseRule,
  primaryInput,
  type PermissionVerdict,
  type PermissionRequest,
} from './permissions.js';
