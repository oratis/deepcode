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
export declare function withAdditionalWritableDirs(sandbox: SandboxConfig | undefined, dirs: readonly string[] | undefined, cwd?: string): SandboxConfig | undefined;
//# sourceMappingURL=additional-dirs.d.ts.map