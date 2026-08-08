// Runtime capability declaration — what this runtime may write, and which
// actions always need a human.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.C
//
// `initialize()` already reports capabilities, but they are all *protocol*
// features (threadResume, workspaceDiff, …). No client can ask the question
// that actually matters before it starts trusting a runtime: where will this
// thing write, and what will it stop to ask me about?
//
// This is that answer, built by ONE function so the CLI and the app-server
// cannot drift — which is also what makes the alignment plan's P0 ("permission
// and tool execution are not a unified runtime capability") testable rather
// than aspirational.

import { resolveSandboxMode } from '../sandbox/policy.js';
import type { PermissionRules, SandboxConfig, SandboxMode } from '../config/types.js';
import type { FileContractStatus } from '../config/file-contract-loader.js';
import type { Mode } from '../types.js';

/**
 * Actions that require explicit user confirmation regardless of permission
 * mode, mirroring Selfware's `confirmation_required`.
 *
 * These are the operations wired through the No Silent Apply ceremony. Listing
 * them in the declaration means a client can render "this runtime will always
 * stop and ask before X" without having to know the implementation.
 */
export const ALWAYS_CONFIRMED_ACTIONS = Object.freeze([
  'ledger.rollback',
  'plugin.install',
  'contract.change',
  'trust.grant',
] as const);

export interface RuntimeCapabilities {
  /** Absolute paths the runtime may write to under the current sandbox. */
  writeScope: string[];
  /** Actions that always need confirmation, whatever the permission mode. */
  confirmationRequired: string[];
  sandbox: {
    mode: SandboxMode;
    /** False when the mode is `danger-full-access` — no OS-level bound at all. */
    effective: boolean;
  };
  permissions: {
    mode: Mode;
    /** Whether a path-axis contract is loaded, absent, or unparseable. */
    fileContract: FileContractStatus;
    /** Tool-rule counts; the rules themselves can hold user paths. */
    ruleCounts: { allow: number; ask: number; deny: number };
  };
  ledger: {
    enabled: boolean;
    /** Where records are written; empty when disabled. */
    path: string;
  };
  /** Optional subsystems and whether they are on for this runtime. */
  modules: Record<string, 'enabled' | 'disabled'>;
}

export interface BuildRuntimeCapabilitiesInput {
  cwd: string;
  mode: Mode;
  permissions?: PermissionRules;
  sandboxConfig?: SandboxConfig;
  sandboxDefaultMode?: SandboxMode;
  fileContract: FileContractStatus;
  ledger?: { enabled: boolean; path: string };
  modules?: Record<string, boolean>;
}

/**
 * Build the declaration. Pure, so two hosts given the same settings produce
 * byte-identical output — that equality is the point, and it is asserted in
 * tests rather than assumed.
 */
export function buildRuntimeCapabilities(
  input: BuildRuntimeCapabilitiesInput,
): RuntimeCapabilities {
  const mode = resolveSandboxMode(
    input.sandboxConfig,
    input.sandboxDefaultMode ?? 'workspace-write',
  );
  const rules = input.permissions ?? {};

  return {
    writeScope: writeScopeFor(mode, input.cwd, input.sandboxConfig),
    confirmationRequired: [...ALWAYS_CONFIRMED_ACTIONS],
    sandbox: { mode, effective: mode !== 'danger-full-access' },
    permissions: {
      mode: input.mode,
      fileContract: input.fileContract,
      ruleCounts: {
        allow: rules.allow?.length ?? 0,
        ask: rules.ask?.length ?? 0,
        deny: rules.deny?.length ?? 0,
      },
    },
    ledger: input.ledger ?? { enabled: false, path: '' },
    modules: Object.fromEntries(
      Object.entries(input.modules ?? {}).map(([name, on]) => [name, on ? 'enabled' : 'disabled']),
    ),
  };
}

/**
 * The writable set, as a client should understand it.
 *
 * `danger-full-access` reports `['<everything>']` rather than an empty list.
 * An empty array reads as "writes nowhere", which is the exact opposite of the
 * truth and the most dangerous thing this declaration could get wrong.
 */
function writeScopeFor(
  mode: SandboxMode,
  cwd: string,
  config: SandboxConfig | undefined,
): string[] {
  if (mode === 'danger-full-access') return ['<everything: sandbox disabled>'];
  if (mode === 'read-only') return [];
  return [cwd, ...(config?.filesystem?.allowWrite ?? [])];
}
