// Loop-hygiene guards — plugins that watch the agent loop for unproductive
// patterns and enforce per-call budgets. A guard never vetoes a call on
// behavioral grounds; it advises, or it enforces a deployment budget.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.2, §1.3

export {
  RepeatToolGuard,
  DEFAULT_REPEAT_EXCLUDE,
  type RepeatGuardOptions,
  type RepeatReminder,
  type RepeatReminderKind,
} from './repeat-tool.js';
export {
  resolveToolDeadlineMs,
  deadlineMessage,
  DEFAULT_TOOL_DEADLINE_MS,
  SIDE_EFFECTING_TOOLS,
  type ToolDeadlineConfig,
} from './tool-deadline.js';
