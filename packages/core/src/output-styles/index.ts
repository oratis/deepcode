// Output styles subsystem entry.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13b
// Milestone: M4

export {
  loadOutputStyles,
  findStyle,
  applyStyle,
  BUILTIN_STYLES,
  type OutputStyle,
  type OutputStyleFrontmatter,
  type LoadOutputStylesOpts,
} from './loader.js';
