// Trust gating — when a working directory isn't trusted, strip the settings
// fields that execute arbitrary code (hooks, MCP servers, apiKeyHelper,
// statusLine) IF they came from the project/local layers. The user-global layer
// (~/.deepcode/settings.json) is always trusted, so its values are kept.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.10 (Trust dialog)

import type { LoadedSettings } from './loader.js';
import type { DeepCodeSettings } from './types.js';

export type TrustStatus = 'trusted' | 'plan-only' | 'untrusted';

/** Project/local settings fields that can execute arbitrary shell/processes. */
export const TRUST_GATED_FIELDS = ['hooks', 'mcpServers', 'apiKeyHelper', 'statusLine'] as const;
export type TrustGatedField = (typeof TRUST_GATED_FIELDS)[number];

export interface GateResult {
  /** The effective settings after gating (a shallow copy; layers untouched). */
  settings: DeepCodeSettings;
  /** Gated fields that were present in the project/local layers and stripped. */
  gated: TrustGatedField[];
}

function copyOrDelete(dst: DeepCodeSettings, src: DeepCodeSettings, key: TrustGatedField): void {
  const v = src[key];
  if (v !== undefined) (dst as Record<string, unknown>)[key] = v;
  else delete (dst as Record<string, unknown>)[key];
}

/**
 * Return the effective settings for a directory at the given trust `status`.
 *
 * - `trusted`     → merged settings unchanged.
 * - `untrusted` / `plan-only` → each exec-bearing field is reset to the
 *   user-global layer's value (or removed if the user layer doesn't set it),
 *   so a project's `.deepcode/settings.json` can't run code until the user
 *   trusts the directory. `gated` lists which fields were actually stripped
 *   (i.e. the project/local layer had tried to set them).
 */
export function gateUntrustedSettings(loaded: LoadedSettings, status: TrustStatus): GateResult {
  if (status === 'trusted') return { settings: loaded.merged, gated: [] };

  const user = loaded.layers.user ?? {};
  const { project, local, override } = loaded.layers;
  const settings: DeepCodeSettings = { ...loaded.merged };
  const gated: TrustGatedField[] = [];

  for (const key of TRUST_GATED_FIELDS) {
    if (project?.[key] !== undefined || local?.[key] !== undefined) gated.push(key);
    // Reset to the always-trusted user layer (strips untrusted project/local).
    copyOrDelete(settings, user, key);
    // `--settings <file>` is an explicit user choice → trusted; re-apply its
    // value on top so an override's hooks/mcp survive in an untrusted dir.
    if (override?.[key] !== undefined) (settings as Record<string, unknown>)[key] = override[key];
  }
  return { settings, gated };
}
