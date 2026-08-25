// Shells that survive between tool calls.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.4

export { PersistentShell, type ShellRunResult, type ShellSessionOptions } from './session.js';
export { ShellRegistry, type ShellInfo, type ShellRegistryOptions } from './registry.js';
