// Tool deadline — a backstop for a tool call that never returns at all.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.3
//
// This is explicitly NOT the primary timeout. Most tools already bound
// themselves: Bash takes a `timeout`, WebFetch has a fetch deadline, ripgrep
// exits. Those inner limits fire first and produce a specific error, which is
// the better outcome. This layer exists for the case where the inner limit does
// not fire — a hung network mount, a fetch stuck before its own timer arms, a
// tool that simply forgot — where the alternative today is an agent turn that
// hangs forever with nothing on screen but a blinking cursor.
//
// Because it is a backstop, the default is generous. A deadline that races the
// inner timeout would replace a precise error with a vague one.

/** Tools whose interruption can leave the workspace in an unknown state. */
export const SIDE_EFFECTING_TOOLS = new Set(['Bash', 'Edit', 'Write', 'NotebookEdit']);

/** Grace added to a caller-requested timeout so the tool's own limit fires first. */
const REQUESTED_TIMEOUT_GRACE_MS = 30_000;

/** Backstop for a tool that neither declares nor honors a limit of its own. */
export const DEFAULT_TOOL_DEADLINE_MS = 600_000;

export interface ToolDeadlineConfig {
  /** Applied to any tool without a `perTool` entry. */
  defaultMs?: number;
  /** Per-tool overrides, by tool name. */
  perTool?: Record<string, number>;
  /** Turn the backstop off entirely. */
  disabled?: boolean;
}

/**
 * Resolve the backstop deadline for one call.
 *
 * A caller-requested `timeout` in the tool's own arguments always wins when it
 * is longer than the configured backstop: `Bash({ timeout: 900000 })` is an
 * explicit request for a 15-minute command, and a 10-minute backstop killing it
 * would make the tool's own parameter a lie.
 *
 * @param tool Tool name.
 * @param input The call's arguments.
 * @param config Deployment configuration, if any.
 * @returns Milliseconds to allow, or undefined when no deadline applies.
 */
export function resolveToolDeadlineMs(
  tool: string,
  input: Record<string, unknown>,
  config?: ToolDeadlineConfig,
): number | undefined {
  if (config?.disabled) return undefined;
  const base = config?.perTool?.[tool] ?? config?.defaultMs ?? DEFAULT_TOOL_DEADLINE_MS;
  const requested = input['timeout'];
  if (typeof requested === 'number' && Number.isFinite(requested) && requested > 0) {
    return Math.max(base, requested + REQUESTED_TIMEOUT_GRACE_MS);
  }
  return base;
}

/**
 * The message shown when the backstop fires.
 *
 * For a side-effecting tool this states plainly that the effect is unknown.
 * Aborting the wait does not abort the work: the process may still be running,
 * and reporting "it did not happen" would be a guess presented as a fact.
 *
 * @param tool Tool name.
 * @param ms The deadline that elapsed.
 * @returns Text for the tool result.
 */
export function deadlineMessage(tool: string, ms: number): string {
  const base = `Error: ${tool} did not return within ${Math.round(ms / 1000)}s and was abandoned.`;
  return SIDE_EFFECTING_TOOLS.has(tool)
    ? `${base} It may still be running, and whether it changed anything is unknown — check the current state before retrying.`
    : `${base} Narrow the request (a smaller scope, a filter, a more specific path) and try again.`;
}
