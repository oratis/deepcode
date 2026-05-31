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
} from './types.js';

export {
  loadSettings,
  writeSettings,
  settingsPaths,
  deepMerge,
  appendAllowMatcher,
  type LoadedSettings,
  type LoadSettingsOpts,
} from './loader.js';

export {
  gateUntrustedSettings,
  TRUST_GATED_FIELDS,
  type TrustStatus,
  type TrustGatedField,
  type GateResult,
} from './trust-gate.js';

export {
  evaluatePermission,
  matchRule,
  parseRule,
  primaryInput,
  type PermissionVerdict,
  type PermissionRequest,
} from './permissions.js';
