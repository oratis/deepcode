// Folds `permissions.additionalDirectories` into the sandbox's writable roots.
//
// The file tools (Read/Write/Edit/Glob/Grep) already accept any absolute path —
// there is no cwd containment to widen. The only thing that actually restricts
// writes is the OS sandbox wrapping Bash, so "enforcing /add-dir" means adding
// those directories to `filesystem.allowWrite`.
//
// Every host that builds a SandboxConfig must route through this, or the
// setting is enforced in some clients and silently ignored in others.

import { isAbsolute, resolve } from 'node:path';
import type { SandboxConfig } from '../config/types.js';

/**
 * Return a copy of `sandbox` whose `filesystem.allowWrite` also contains
 * `dirs`. Never mutates its input. A no-op when the sandbox is disabled or
 * `dirs` is empty, so hosts can call it unconditionally.
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
  if (!sandbox?.enabled) return sandbox;
  if (!dirs || dirs.length === 0) return sandbox;

  const normalized = dirs
    .map((dir) => (isAbsolute(dir) ? dir : cwd ? resolve(cwd, dir) : undefined))
    .filter((dir): dir is string => dir !== undefined);
  if (normalized.length === 0) return sandbox;

  const existing = sandbox.filesystem?.allowWrite ?? [];
  const merged = [...new Set([...existing, ...normalized])];
  if (merged.length === existing.length) return sandbox;

  return {
    ...sandbox,
    filesystem: { ...sandbox.filesystem, allowWrite: merged },
  };
}
