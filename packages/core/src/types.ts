// Shared types for @deepcode/core
// Most types will be moved/refined as modules ship per milestone.

/**
 * Logical "run mode" of an agent session.
 * Spec: docs/DEVELOPMENT_PLAN.md §3.8
 */
export type Mode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions';

/**
 * Effort tier — controls max_tokens / temperature / multi-turn budget.
 * Spec: docs/design/effort-levels.md
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Supported DeepSeek model identifiers.
 * Spec: docs/DEVELOPMENT_PLAN.md §3.1
 */
export type DeepSeekModel = 'deepseek-chat' | 'deepseek-reasoner';

/**
 * Hook event names — 9 events total.
 * Spec: docs/DEVELOPMENT_PLAN.md §3.6
 */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact'
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'Notification';

/**
 * Hook handler type discriminant.
 * Spec: docs/DEVELOPMENT_PLAN.md §3.6
 */
export type HookHandlerType = 'command' | 'http' | 'mcp_tool' | 'prompt' | 'agent';

/**
 * Result of running ToolDispatcher.evaluate().
 * Spec: docs/design/sandbox-plan-worktree.md §5.1
 */
export interface ToolVerdict {
  allow: boolean;
  reason?: string;
}
