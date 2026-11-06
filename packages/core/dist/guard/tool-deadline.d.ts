/** Tools whose interruption can leave the workspace in an unknown state. */
export declare const SIDE_EFFECTING_TOOLS: Set<string>;
/** Backstop for a tool that neither declares nor honors a limit of its own. */
export declare const DEFAULT_TOOL_DEADLINE_MS = 600000;
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
export declare function resolveToolDeadlineMs(tool: string, input: Record<string, unknown>, config?: ToolDeadlineConfig): number | undefined;
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
export declare function deadlineMessage(tool: string, ms: number): string;
//# sourceMappingURL=tool-deadline.d.ts.map