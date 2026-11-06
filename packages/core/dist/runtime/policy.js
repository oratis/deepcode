/**
 * Tools that a host without an approval UI may safely expose by default.
 * Unknown, write-capable, and extension-provided tools intentionally do not
 * appear here, so they resolve to `ask` and are blocked when no approval
 * callback is installed.
 */
export const SAFE_READONLY_TOOLS = Object.freeze([
    'Read',
    'Grep',
    'Glob',
    'WebFetch',
    'WebSearch',
    'AskUserQuestion',
    'SubmitReviewFinding',
    'ExitPlanMode',
    'ToolSearch',
]);
export const SAFE_DEFAULT_PERMISSIONS = Object.freeze({
    allow: [...SAFE_READONLY_TOOLS],
});
/**
 * Runtime fallback for untyped/legacy callers. Typed callers must still pass
 * `mode`, but JavaScript and stale integrations fail safe instead of silently
 * bypassing the dispatcher.
 */
export function resolveRuntimePolicy(input) {
    return {
        mode: input.mode ?? 'default',
        permissions: input.permissions ?? { allow: [...SAFE_READONLY_TOOLS] },
    };
}
//# sourceMappingURL=policy.js.map