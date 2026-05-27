// Tool dispatcher — the central gate. Combines mode + permission + hook decision
// into a single allow/ask/deny verdict.
// Spec: docs/design/sandbox-plan-worktree.md §5.1
//       docs/DEVELOPMENT_PLAN.md §3.8 / §3.15

import { evaluateMode, type ModeRequest, type ModeVerdict } from '../modes/index.js';
import {
  evaluatePermission,
  type PermissionRequest,
  type PermissionVerdict,
} from '../config/permissions.js';
import type { PermissionRules } from '../config/types.js';
import type { Mode } from '../types.js';
import type { HookDispatcher, HookResult } from '../hooks/index.js';

export interface DispatchRequest {
  tool: string;
  input: Record<string, unknown>;
  mode: Mode;
  rules?: PermissionRules;
  hooks?: HookDispatcher;
  cwd: string;
}

export interface DispatchVerdict {
  /** Final decision after all gates. */
  decision: 'allow' | 'ask' | 'deny' | 'plan-blocked';
  /** Where the decision came from (for UI/logging). */
  source: 'mode' | 'permission' | 'hook';
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
 * Evaluate a tool call against mode + permission + PreToolUse hook.
 *
 * Decision order (per docs/design/sandbox-plan-worktree.md §5.1):
 *   1. Mode policy (plan-blocked / deny short-circuit immediately)
 *   2. Permission rules (mode policy can demote/upgrade to ask)
 *   3. PreToolUse hook chain (can override the prior decision via JSON output)
 *
 * Sandbox (M3.5) is enforced separately at the OS layer — not here.
 */
export async function dispatchToolCall(req: DispatchRequest): Promise<DispatchVerdict> {
  // Step 1: Permission verdict
  const permReq: PermissionRequest = { tool: req.tool, input: req.input };
  const permVerdict = evaluatePermission(permReq, req.rules);

  // Step 2: Mode policy (incorporates permission verdict)
  const modeReq: ModeRequest = {
    tool: req.tool,
    input: req.input,
    permissionVerdict: permVerdict,
  };
  const modeVerdict = evaluateMode(req.mode, modeReq);

  // Plan-block short-circuits — hook doesn't even fire
  if (modeVerdict === 'plan-blocked') {
    return {
      decision: 'plan-blocked',
      source: 'mode',
      reason: `Tool "${req.tool}" blocked: mode=plan (read-only); call would write.`,
      modeVerdict,
      permissionVerdict: permVerdict,
    };
  }

  // Step 3: PreToolUse hook (only if mode didn't outright deny)
  let hookResult: HookResult | undefined;
  if (req.hooks && modeVerdict !== 'deny') {
    hookResult = await req.hooks.dispatch({
      event: 'PreToolUse',
      cwd: req.cwd,
      triggeredAt: new Date().toISOString(),
      payload: { tool: req.tool, input: req.input },
    });

    // Hook JSON output may override
    if (hookResult.json?.decision === 'deny' || hookResult.json?.permissionDecision === 'deny') {
      return {
        decision: 'deny',
        source: 'hook',
        reason: hookResult.json.systemMessage ?? 'Hook denied this tool call.',
        hook: hookResult,
        modeVerdict,
        permissionVerdict: permVerdict,
      };
    }
    if (hookResult.json?.decision === 'ask' || hookResult.json?.permissionDecision === 'ask') {
      return {
        decision: 'ask',
        source: 'hook',
        reason: hookResult.json.systemMessage ?? 'Hook requested approval.',
        hook: hookResult,
        modeVerdict,
        permissionVerdict: permVerdict,
      };
    }
    // Hook exited non-zero → treat as deny
    if (hookResult.anyBlocked) {
      return {
        decision: 'deny',
        source: 'hook',
        reason: 'A PreToolUse hook exited non-zero — blocking call.',
        hook: hookResult,
        modeVerdict,
        permissionVerdict: permVerdict,
      };
    }
  }

  // Otherwise use mode verdict
  return {
    decision: modeVerdict,
    source: modeVerdict === 'allow' && permVerdict === 'allow' ? 'permission' : 'mode',
    reason: explain(modeVerdict, permVerdict, req.mode),
    hook: hookResult,
    modeVerdict,
    permissionVerdict: permVerdict,
  };
}

function explain(mode: ModeVerdict, perm: PermissionVerdict, modeName: Mode): string {
  if (mode === 'allow' && perm === 'allow') return 'allowed by permission rules';
  if (mode === 'allow') return `auto-allowed by mode "${modeName}"`;
  if (mode === 'ask') return 'requires approval';
  if (mode === 'deny') return `denied by mode "${modeName}"`;
  return 'unknown';
}
