import { type ModeVerdict } from '../modes/index.js';
import { type PermissionVerdict } from '../config/permissions.js';
import type { FileContract } from '../config/file-contract.js';
import type { AutoModeConfig, PermissionRules } from '../config/types.js';
import type { Mode } from '../types.js';
import type { HookDispatcher, HookResult } from '../hooks/index.js';
import type { Provider } from '../providers/types.js';
export interface DispatchRequest {
    tool: string;
    input: Record<string, unknown>;
    mode: Mode;
    rules?: PermissionRules;
    /** Path-axis rules. Absent means the contract has no opinion on anything. */
    contract?: FileContract;
    hooks?: HookDispatcher;
    cwd: string;
    /** AutoModeConfig from settings — required when mode === 'auto'. */
    autoMode?: AutoModeConfig;
    /** Provider used for the LLM classifier in auto mode. */
    autoModeProvider?: Provider;
}
export interface DispatchVerdict {
    /** Final decision after all gates. */
    decision: 'allow' | 'ask' | 'deny' | 'plan-blocked';
    /** Where the decision came from (for UI/logging). */
    source: 'mode' | 'permission' | 'hook' | 'contract';
    /** Human-readable explanation. */
    reason: string;
    /** If hook produced JSON output, surfaced here so caller can use additionalContext etc. */
    hook?: HookResult;
    /** Permission verdict (for diagnostic). */
    permissionVerdict?: PermissionVerdict;
    /** Mode verdict (for diagnostic). */
    modeVerdict?: ModeVerdict;
}
/**
 * Evaluate a tool call against contract + mode + permission + PreToolUse hook.
 *
 * Decision order (per docs/design/sandbox-plan-worktree.md §5.1):
 *   0. File contract `deny` (absolute — see below)
 *   1. Mode policy (plan-blocked / deny short-circuit immediately)
 *   2. Permission rules, tightened by the contract's path verdict
 *   3. PreToolUse hook chain (can override the prior decision via JSON output)
 *
 * A contract `deny` is checked first and cannot be waived, including by
 * `bypassPermissions`. It is a standing statement about a path ("never read
 * .env"), not a per-call prompt, so a mode that exists to skip prompts has no
 * business clearing it — otherwise the contract's strongest sentence would also
 * be its easiest to disable. Contract `ask` is ordinary and follows mode.
 *
 * Sandbox (M3.5) is enforced separately at the OS layer — not here.
 */
export declare function dispatchToolCall(req: DispatchRequest): Promise<DispatchVerdict>;
//# sourceMappingURL=tool-dispatcher.d.ts.map