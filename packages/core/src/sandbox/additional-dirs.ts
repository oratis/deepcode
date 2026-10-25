// Folds `permissions.additionalDirectories` into the sandbox's writable roots.
//
// Both direct file mutations and the OS sandbox wrapping Bash consume
// `filesystem.allowWrite`, including hosts using the default workspace mode.
//
// Every host that builds a SandboxConfig must route through this, or the
// setting is enforced in some clients and silently ignored in others.

import { isAbsolute, resolve } from 'node:path';
import type { SandboxConfig } from '../config/types.js';
import { resolveSandboxMode } from './policy.js';

/**
 * Return a copy of `sandbox` whose `filesystem.allowWrite` also contains
 * `dirs`. Never mutates its input. Only workspace-write widens writable roots;
 * read-only and danger-full-access keep their existing semantics.
 *
 * Relative entries are resolved against `cwd` when provided; entries that are
 * still not absolute are dropped rather than being handed to the sandbox
 * profile writer, which expects absolute paths.
 */
export function withAdditionalWritableDirs(
  sandbox: SandboxConfig | undefined,
  dirs: readonly string[] | undefined,
  cwd?: string,
): SandboxConfig | undefined {
  if (resolveSandboxMode(sandbox) !== 'workspace-write') return sandbox;
  if (!dirs || dirs.length === 0) return sandbox;

  const normalized = dirs
    .map((dir) => (isAbsolute(dir) ? dir : cwd ? resolve(cwd, dir) : undefined))
    .filter((dir): dir is string => dir !== undefined);
  if (normalized.length === 0) return sandbox;

  const existing = sandbox?.filesystem?.allowWrite ?? [];
  const merged = [...new Set([...existing, ...normalized])];
  if (merged.length === existing.length) return sandbox;

  return {
    ...sandbox,
    filesystem: { ...sandbox?.filesystem, allowWrite: merged },
  };
}
