import type { LoadedSettings } from './loader.js';
import type { DeepCodeSettings } from './types.js';
export type TrustStatus = 'trusted' | 'plan-only' | 'untrusted';
/** Project/local settings fields that can execute code or widen runtime authority. */
export declare const TRUST_GATED_FIELDS: readonly ["model", "baseURL", "forceLoginMethod", "effortLevel", "effortBudgets", "effortOverrides", "alwaysThinkingEnabled", "permissions", "autoMode", "sandbox", "env", "hooks", "allowedHttpHookUrls", "httpHookAllowedEnvVars", "mcpServers", "enableAllProjectMcpServers", "enabledMcpjsonServers", "apiKeyHelper", "statusLine", "voice", "worktree", "update", "plugins"];
export type TrustGatedField = (typeof TRUST_GATED_FIELDS)[number];
export interface GateResult {
    /** The effective settings after gating (a shallow copy; layers untouched). */
    settings: DeepCodeSettings;
    /** Gated fields that were present in the project/local layers and stripped. */
    gated: TrustGatedField[];
}
/**
 * Return the effective settings for a directory at the given trust `status`.
 *
 * - `trusted`     → merged settings unchanged.
 * - `untrusted` / `plan-only` → each authority-bearing field is reset to the
 *   user-global layer's value (or removed if the user layer doesn't set it),
 *   so a project's `.deepcode/settings.json` can't run code until the user
 *   trusts the directory. `gated` lists which fields were actually stripped
 *   (i.e. the project/local layer had tried to set them).
 */
export declare function gateUntrustedSettings(loaded: LoadedSettings, status: TrustStatus): GateResult;
//# sourceMappingURL=trust-gate.d.ts.map