// Sessions subsystem entry — jsonl storage + snapshots + manager.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5
// Milestone: M1

export { SessionManager } from './manager.js';
export type { SessionManagerOpts } from './manager.js';
export {
  defaultSessionsDir,
  newSessionId,
  type SessionMeta,
  type SessionFiles,
} from './storage.js';
export {
  captureSnapshot,
  captureGitCheckpoint,
  listSnapshots,
  restoreSnapshot,
  type Snapshot,
} from './snapshots.js';
