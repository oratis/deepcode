// Sessions subsystem entry — jsonl storage + snapshots + manager.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5
// Milestone: M1

export { SessionManager } from './manager.js';
export type { SessionManagerOpts } from './manager.js';
export {
  defaultSessionsDir,
  newSessionId,
  readSessionRecords,
  SessionCorruptionError,
  type SessionMeta,
  type SessionFiles,
  type SessionDiagnostic,
  type SessionFormat,
  type SessionReadResult,
} from './storage.js';
export {
  captureSnapshot,
  captureGitCheckpoint,
  listSnapshots,
  restoreSnapshot,
  type Snapshot,
} from './snapshots.js';
