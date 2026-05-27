// Hook subsystem types.
// Spec: docs/DEVELOPMENT_PLAN.md §3.6

import type { HookEventName, HookMatcher } from '../config/types.js';

/**
 * Structured JSON output that a hook handler MAY produce on stdout to influence
 * the agent. Unknown fields are tolerated; missing fields default to no-op.
 */
export interface HookHandlerOutput {
  decision?: 'allow' | 'deny' | 'ask';
  permissionDecision?: 'allow' | 'deny' | 'ask';
  hookSpecificOutput?: string;
  /** Inserted into the next LLM call as additional system context. */
  additionalContext?: string;
  /** Shown to user as a red banner. */
  systemMessage?: string;
  /** If this is a Stop hook, the reason for stopping. */
  stopReason?: string;
  /** If true, the hook's stdout is NOT echoed to the user. */
  suppressOutput?: boolean;
}

export interface HookContext {
  cwd: string;
  /** ISO timestamp. */
  triggeredAt: string;
  /** Event name. */
  event: HookEventName;
  /** Event-specific payload (e.g. tool call info for PreToolUse). */
  payload: Record<string, unknown>;
  /** Env vars passed to command-type hooks. */
  env?: Record<string, string>;
}

export interface HookResult {
  /** Concatenated stdout of all handlers that ran. */
  stdout: string;
  /** Concatenated stderr. */
  stderr: string;
  /** Parsed JSON output of the LAST handler that emitted valid JSON. */
  json?: HookHandlerOutput;
  /** True if ANY handler exited with non-zero (signals the agent to block). */
  anyBlocked: boolean;
  /** Per-handler timing for debugging. */
  timings: Array<{ matcher?: string; durationMs: number; exitCode: number }>;
}

export interface HookRegistration {
  event: HookEventName;
  matchers: HookMatcher[];
}
