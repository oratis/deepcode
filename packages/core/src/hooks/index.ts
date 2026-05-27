// Hook subsystem — 9 events × `command` handler (M3 ships command only;
// http/mcp_tool/prompt/agent handler types deferred to M5+).
// Spec: docs/DEVELOPMENT_PLAN.md §3.6
// Milestone: M3

export {
  HookDispatcher,
  runCommand,
  tryParseJsonOutput,
  type HookDispatcherOpts,
} from './dispatcher.js';

export type { HookContext, HookHandlerOutput, HookResult, HookRegistration } from './types.js';
