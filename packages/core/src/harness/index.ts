// Harness layer entry — tool dispatcher (mode × permission × hooks gating).
// Spec: docs/DEVELOPMENT_PLAN.md §3.15
// Milestone: M3b — basic gating wired; system-reminder injector / TaskCreate /
// cron / worktree / ToolSearch / Notification / statusLine implementation will
// land in M3c+.

export { dispatchToolCall, type DispatchRequest, type DispatchVerdict } from './tool-dispatcher.js';
