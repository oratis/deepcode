// Sessions subsystem entry — jsonl storage + snapshots + manager.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5
// Milestone: M1
export { SessionManager } from './manager.js';
export { defaultSessionsDir, newSessionId, readSessionRecords, writeMeta, SessionCorruptionError, SessionWriterConflictError, } from './storage.js';
export { captureSnapshot, captureGitCheckpoint, listSnapshots, restoreSnapshot, } from './snapshots.js';
export { searchSessions, inWorkspace, excerptAround, } from './search.js';
//# sourceMappingURL=index.js.map