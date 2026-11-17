// Sessions subsystem entry — jsonl storage + snapshots + manager.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5
// Milestone: M1

export { SessionManager, recoverToolResults } from './manager.js';
export type { SessionManagerOpts } from './manager.js';
export {
  defaultSessionsDir,
  newSessionId,
  readSessionRecords,
  writeMeta,
  SessionCorruptionError,
  SessionWriterConflictError,
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
export {
  searchSessions,
  inWorkspace,
  excerptAround,
  type SessionSearchScope,
  type SessionSearchOptions,
  type SessionSearchHit,
  type SessionSearchResult,
} from './search.js';

export {
  SessionJournal,
  projectJournal,
  type JournalEvent,
  type JournalInput,
  type SessionProjection,
} from './journal.js';
export { importLegacySession } from './importer.js';
