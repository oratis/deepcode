// Tool-output spill — entry point.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.1
//
// `local.js` is deliberately NOT re-exported here: it imports node:fs, and this
// module is reachable from the renderer bundle. Hosts with a filesystem import
// it directly.

export { boundText, BoundedCapture, type BoundedText } from './bound.js';
export {
  applySpillPolicy,
  DEFAULT_SPILL_THRESHOLD_CHARS,
  type SpillPolicyOptions,
  type SpillOutcome,
} from './policy.js';
export type { SaveTextRequest, SpillRef, SpillSource, SpillStore } from './types.js';
