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
 *
 * NOTE (validated against real API 2026-05-28):
 * - `deepseek-chat` and `deepseek-reasoner` are STABLE ALIASES still accepted by the API.
 * - Actual current backing models per /v1/models endpoint are `deepseek-v4-flash`
 *   and `deepseek-v4-pro`. We support both alias names AND concrete v4 names so
 *   either works in user config.
 *
 * Spec: docs/DEVELOPMENT_PLAN.md §3.1
 */
export type DeepSeekModel =
  | 'deepseek-chat' // alias → currently routes to deepseek-v4-flash
  | 'deepseek-reasoner' // alias → currently routes to reasoning-capable model
  | 'deepseek-v4-flash'
  | 'deepseek-v4-pro';

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
  /** Optional platform sandbox config — passed through to Bash tool (M3.5). */
  sandboxConfig?: import('./config/types.js').SandboxConfig;
  /**
   * Host callback for interactive prompts (AskUserQuestion). Returns undefined
   * in headless mode. Called by the AskUserQuestion tool with the question +
   * options; resolves to the chosen label (or 'Other: <text>' if free input).
   */
  askUser?: (req: {
    question: string;
    options: Array<{ label: string; description: string }>;
    multiSelect?: boolean;
  }) => Promise<string>;
  /**
   * Mutable host state that the EnterPlanMode / ExitPlanMode tools flip. The
   * agent-loop owner reads this after the run and changes the active mode
   * accordingly (plan ⇄ default).
   */
  modeSignal?: { exitPlanMode?: boolean; enterPlanMode?: boolean };
  /**
   * Run a sub-agent (the Task tool). Supplied by the agent loop when sub-agent
   * recursion depth allows; absent in the renderer or at max depth (so a
   * sub-agent can't spawn further sub-agents). Resolves to the sub-agent's
   * final assistant text.
   */
  runSubAgent?: (opts: {
    prompt: string;
    agentType?: string;
    description?: string;
    /** Per-call abort (used by background tasks so TaskStop can cancel one). */
    signal?: AbortSignal;
  }) => Promise<{ text: string; turnsUsed: number; agentType: string }>;
  /**
   * Active git worktree the agent has entered via EnterWorktree. While set,
   * `cwd` points into the worktree; ExitWorktree reads this to remove the
   * worktree and restore the original cwd. Mutated in place by those tools.
   */
  worktree?: { path: string; branch: string; source: string; originalCwd: string };
  /**
   * Background-task manager (the TaskCreate family + Monitor). Supplied by the
   * agent loop at the top level; absent in sub-agents (so a background task
   * can't spawn more) and in the renderer.
   */
  tasks?: import('./tasks/manager.js').TaskManager;
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
  | {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      cacheReadTokens: number;
    }
  | { type: 'error'; error: string };

/**
 * Result of running ToolDispatcher.evaluate().
 * Spec: docs/design/sandbox-plan-worktree.md §5.1
 */
export interface ToolVerdict {
  allow: boolean;
  reason?: string;
}
