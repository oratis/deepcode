// The line differ now lives in core so the CLI renders the same diffs the file
// panel does. Re-exported here so the panel's imports stay put.
export { computeLineDiff, hasChanges } from '@deepcode/core/dist/util/diff.js';
