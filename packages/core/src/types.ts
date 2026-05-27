// Shared types for @deepcode/core
// These are DeepCode-internal types — provider-agnostic. Each provider converts
// to/from these (DeepSeekProvider <-> OpenAI shape; future providers <-> their shape).

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

// ──────────────────────────────────────────────────────────────────────────
// Content blocks — canonical DeepCode message format
// ──────────────────────────────────────────────────────────────────────────

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  text: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

// ──────────────────────────────────────────────────────────────────────────
// Messages & stored history
// ──────────────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant';

export interface StoredMessage {
  role: MessageRole;
  content: ContentBlock[];
  /** ISO8601 wall-clock for the message envelope. */
  timestamp?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Tools — definition + execution context + result
// ──────────────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema describing the input shape. */
  inputSchema: Record<string, unknown>;
}

export interface ToolContext {
  /** Working directory for relative path resolution. */
  cwd: string;
  /** Where to write session-scoped artifacts (snapshots, bg task logs, etc.). */
  sessionDir?: string;
  /** Abort signal propagated from the agent loop. */
  signal?: AbortSignal;
}

export interface ToolResult {
  content: string;
  /** Optional structured payload — used for UI rendering (e.g. diff blocks). */
  data?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolHandler {
  name: string;
  definition: ToolDefinition;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// ──────────────────────────────────────────────────────────────────────────
// Agent loop events — streamed to UI / persisted to session
// ──────────────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; result: ToolResult }
  | { type: 'turn_complete'; message: StoredMessage }
  | { type: 'usage'; inputTokens: number; outputTokens: number; reasoningTokens: number }
  | { type: 'error'; error: string };

/**
 * Result of running ToolDispatcher.evaluate().
 * Spec: docs/design/sandbox-plan-worktree.md §5.1
 */
export interface ToolVerdict {
  allow: boolean;
  reason?: string;
}
