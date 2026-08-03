// Resolving what the sandbox should actually do.
//
// Two axes, deliberately separate (docs/CODEX_ALIGNMENT_PLAN.md §5.5): `mode`
// (this file) decides what a command may touch; the permission `Mode` decides
// how a tool call gets approved. A single knob could not express "never ask me,
// but still keep writes inside the workspace".
//
// Pure — no fs, no platform checks — so every host resolves the same way.

import type { SandboxConfig, SandboxMode } from '../config/types.js';

export const SANDBOX_MODES: SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access'];

export function isSandboxMode(value: string): value is SandboxMode {
  return (SANDBOX_MODES as string[]).includes(value);
}

/**
 * The mode a config asks for.
 *
 * `mode` wins when set. Otherwise the legacy `enabled` boolean maps on:
 * `true` → workspace-write, `false` → danger-full-access. An unconfigured
 * sandbox resolves to `fallback`, which the caller picks — hosts default to
 * workspace-write, and `resolveSandboxMode(cfg, 'danger-full-access')` recovers
 * the pre-mode behaviour for callers that need it.
 */
export function resolveSandboxMode(
  config: SandboxConfig | undefined,
  fallback: SandboxMode = 'workspace-write',
): SandboxMode {
  if (config?.mode && isSandboxMode(config.mode)) return config.mode;
  if (config?.enabled === true) return 'workspace-write';
  if (config?.enabled === false) return 'danger-full-access';
  return fallback;
}

/**
 * The config a platform profile builder should see, with the resolved mode
 * folded in: the workspace is always readable, and writable in workspace-write.
 *
 * Before this, an enabled macOS sandbox denied reads of the project directory
 * itself — `(deny default)` with no rule for cwd — so `cat src/a.ts` failed
 * inside it while the Linux path bound cwd read-write. Nobody hit it because
 * the sandbox was off by default.
 */
export function sandboxConfigForMode(
  config: SandboxConfig | undefined,
  mode: SandboxMode,
  cwd: string,
  /** Extra paths the workspace depends on — a linked worktree's git dirs. */
  extraWorkspacePaths: string[] = [],
): SandboxConfig | undefined {
  if (mode === 'danger-full-access') return { ...config, enabled: false };

  const filesystem = { ...(config?.filesystem ?? {}) };
  const allowRead = [...(filesystem.allowRead ?? [])];
  const allowWrite = [...(filesystem.allowWrite ?? [])];

  // Git writes to its own directory even for read-ish commands (index.lock,
  // refs, reflog), so the linked dirs go in both lists whenever anything is
  // writable at all.
  for (const path of [cwd, ...extraWorkspacePaths]) {
    if (!allowRead.includes(path)) allowRead.push(path);
    if (mode === 'workspace-write' && !allowWrite.includes(path)) allowWrite.push(path);
  }

  return {
    ...config,
    mode,
    enabled: true,
    filesystem: { ...filesystem, allowRead, allowWrite: mode === 'read-only' ? [] : allowWrite },
  };
}

/** One line for `doctor` / `/status`: what the sandbox will do to a command. */
export function describeSandboxMode(mode: SandboxMode): string {
  switch (mode) {
    case 'read-only':
      return 'read-only — commands can read the workspace but cannot write to it';
    case 'workspace-write':
      return 'workspace-write — commands can write inside the workspace and temp dirs';
    case 'danger-full-access':
      return 'danger-full-access — commands run unsandboxed';
  }
}

/** Apply a `--sandbox <mode>` override on top of whatever settings say. */
export function withSandboxMode(
  config: SandboxConfig | undefined,
  mode: SandboxMode | undefined,
): SandboxConfig | undefined {
  if (!mode) return config;
  // `enabled` is dropped: a stale `enabled: false` in settings must not
  // silently defeat an explicit `--sandbox workspace-write`.
  const { enabled: _enabled, ...rest } = config ?? {};
  return { ...rest, mode };
}
