// Mode policy — turns a (mode, tool-call) pair into an allow/ask/deny verdict.
// Spec: docs/DEVELOPMENT_PLAN.md §3.8
//       docs/design/sandbox-plan-worktree.md §3.2 (decision matrix)

import type { Mode } from '../types.js';

export interface ModeRequest {
  tool: string;
  input: Record<string, unknown>;
  /** Result of evaluatePermission() — most-restrictive of allow/ask/deny/no-match. */
  permissionVerdict: 'allow' | 'ask' | 'deny' | 'no-match';
}

export type ModeVerdict = 'allow' | 'ask' | 'deny' | 'plan-blocked';

/**
 * Set of tool names that perform writes / mutations.
 * Plan mode denies these wholesale (regardless of permission rules).
 */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash']);

/**
 * Tools that are *safe even in plan mode* (read-only).
 * Bash is NOT in here — it could have side effects. Plan-mode-safe tools include
 * read-style tools and tool-introspection tools.
 */
const PLAN_READONLY_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'AskUserQuestion',
  'ExitPlanMode',
  'ToolSearch',
]);

export function evaluateMode(mode: Mode, req: ModeRequest): ModeVerdict {
  switch (mode) {
    case 'plan': {
      // Plan mode: only read-only tools allowed; all others blocked.
      if (PLAN_READONLY_TOOLS.has(req.tool)) return 'allow';
      if (WRITE_TOOLS.has(req.tool)) return 'plan-blocked';
      // Unknown tool — fall through to plan-blocked to be safe
      return 'plan-blocked';
    }

    case 'bypassPermissions':
      // Skip permission rules entirely (sandbox still enforces at OS level — M3.5)
      return 'allow';

    case 'acceptEdits':
      // Auto-allow Edit/Write; everything else follows permission rules
      if (req.tool === 'Edit' || req.tool === 'Write') {
        if (req.permissionVerdict === 'deny') return 'deny';
        return 'allow';
      }
      return interpretPermission(req.permissionVerdict, 'ask');

    case 'dontAsk':
      // Strict allow-list: only `allow` passes; everything else denied (no prompt)
      if (req.permissionVerdict === 'allow') return 'allow';
      return 'deny';

    case 'auto':
      // M3 stub: auto-classifier LLM judgment is M4+. Fall back to default behavior.
      return interpretPermission(req.permissionVerdict, 'ask');

    case 'default':
    default:
      return interpretPermission(req.permissionVerdict, 'ask');
  }
}

/**
 * Map a permission verdict to a mode verdict, with a fallback for `no-match`.
 */
function interpretPermission(
  perm: 'allow' | 'ask' | 'deny' | 'no-match',
  noMatch: ModeVerdict,
): ModeVerdict {
  if (perm === 'allow') return 'allow';
  if (perm === 'deny') return 'deny';
  if (perm === 'ask') return 'ask';
  return noMatch;
}

/** Pretty label for a verdict — useful in error messages / UI. */
export function modeVerdictReason(mode: Mode, verdict: ModeVerdict, tool: string): string {
  switch (verdict) {
    case 'allow':
      return 'allowed';
    case 'ask':
      return 'requires approval';
    case 'deny':
      return `denied by mode "${mode}"`;
    case 'plan-blocked':
      return `blocked: ${tool} is a write tool, mode is plan (read-only)`;
  }
}
