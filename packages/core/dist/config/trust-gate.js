// Trust gating — when a working directory isn't trusted, strip the settings
// fields that execute arbitrary code (hooks, MCP servers, apiKeyHelper,
// statusLine) IF they came from the project/local layers. The user-global layer
// (~/.deepcode/settings.json) is always trusted, so its values are kept.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.10 (Trust dialog)
/** Project/local settings fields that can execute code or widen runtime authority. */
export const TRUST_GATED_FIELDS = [
    'model',
    'baseURL',
    'forceLoginMethod',
    'effortLevel',
    'effortBudgets',
    'effortOverrides',
    'alwaysThinkingEnabled',
    'permissions',
    'autoMode',
    'sandbox',
    'env',
    'hooks',
    'allowedHttpHookUrls',
    'httpHookAllowedEnvVars',
    'mcpServers',
    'enableAllProjectMcpServers',
    'enabledMcpjsonServers',
    'apiKeyHelper',
    'statusLine',
    'voice',
    'worktree',
    'update',
    'plugins',
];
function copyOrDelete(dst, src, key) {
    const v = src[key];
    if (v !== undefined)
        dst[key] = v;
    else
        delete dst[key];
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
export function gateUntrustedSettings(loaded, status) {
    if (status === 'trusted')
        return { settings: loaded.merged, gated: [] };
    const user = loaded.layers.user ?? {};
    const { project, local, override } = loaded.layers;
    const settings = { ...loaded.merged };
    const gated = [];
    for (const key of TRUST_GATED_FIELDS) {
        if (project?.[key] !== undefined || local?.[key] !== undefined)
            gated.push(key);
        // Reset to the always-trusted user layer (strips untrusted project/local).
        copyOrDelete(settings, user, key);
        // `--settings <file>` is an explicit user choice → trusted; re-apply its
        // value on top so an override's hooks/mcp survive in an untrusted dir.
        if (override?.[key] !== undefined)
            settings[key] = override[key];
    }
    return { settings, gated };
}
//# sourceMappingURL=trust-gate.js.map