// Memory subsystem entry — dual-system (DEEPCODE.md + auto-memory) + @-import + rules.
// Spec: docs/DEVELOPMENT_PLAN.md §3.6a
// Milestone: M3

export {
  loadMemory,
  walkUpwards,
  rememberFact,
  projectMemoryPath,
  projectMemoryKey,
  type MemorySource,
  type LoadedMemory,
  type LoadMemoryOpts,
} from './loader.js';
