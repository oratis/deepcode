// Loop-hygiene guards — advisory plugins that watch the agent loop for
// unproductive patterns. A guard never vetoes; it only tells the model what it
// is doing.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.2

export {
  RepeatToolGuard,
  DEFAULT_REPEAT_EXCLUDE,
  type RepeatGuardOptions,
  type RepeatReminder,
  type RepeatReminderKind,
} from './repeat-tool.js';
