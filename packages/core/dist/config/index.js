// Config subsystem — settings.json loading + permission matcher.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9
// Milestone: M2
export { loadSettings, writeSettings, settingsPaths, deepMerge, appendAllowMatcher, } from './loader.js';
export { gateUntrustedSettings, TRUST_GATED_FIELDS, } from './trust-gate.js';
export { DirectoryTrustStore, } from './trust-store.js';
export { HookTrustStore, hookDefinitionHash } from './hook-trust.js';
export { diagnoseSettings, } from './diagnostics.js';
export { validateSettingsShallow } from './validation.js';
export { evaluatePermission, matchRule, parseRule, primaryInput, } from './permissions.js';
export { evaluatePath, globMatches, normalizeContractPath, parseFileContract, specificity, DEFAULT_CONTRACT_DEFAULTS, FileContractError, } from './file-contract.js';
export { contractNeedsSandbox, fileContractPaths, loadFileContract, RECOMMENDED_FILE_CONTRACT, } from './file-contract-loader.js';
export { contractGovernedTools, evaluateContract, fileContractWarnings, mostRestrictive, withheldNotice, withholdDeniedReads, } from './contract-dispatch.js';
//# sourceMappingURL=index.js.map