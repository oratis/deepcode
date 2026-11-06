import type { SandboxConfig, SandboxMode } from '../config/types.js';
export declare const SANDBOX_MODES: SandboxMode[];
export declare function isSandboxMode(value: string): value is SandboxMode;
/**
 * The mode a config asks for.
 *
 * `mode` wins when set. Otherwise the legacy `enabled` boolean maps on:
 * `true` → workspace-write, `false` → danger-full-access. An unconfigured
 * sandbox resolves to `fallback`, which the caller picks — hosts default to
 * workspace-write, and `resolveSandboxMode(cfg, 'danger-full-access')` recovers
 * the pre-mode behaviour for callers that need it.
 */
export declare function resolveSandboxMode(config: SandboxConfig | undefined, fallback?: SandboxMode): SandboxMode;
/**
 * The config a platform profile builder should see, with the resolved mode
 * folded in: the workspace is always readable, and writable in workspace-write.
 *
 * Before this, an enabled macOS sandbox denied reads of the project directory
 * itself — `(deny default)` with no rule for cwd — so `cat src/a.ts` failed
 * inside it while the Linux path bound cwd read-write. Nobody hit it because
 * the sandbox was off by default.
 */
export declare function sandboxConfigForMode(config: SandboxConfig | undefined, mode: SandboxMode, cwd: string, 
/** Extra paths the workspace depends on — a linked worktree's git dirs. */
extraWorkspacePaths?: string[]): SandboxConfig | undefined;
/** One line for `doctor` / `/status`: what the sandbox will do to a command. */
export declare function describeSandboxMode(mode: SandboxMode): string;
/** Apply a `--sandbox <mode>` override on top of whatever settings say. */
export declare function withSandboxMode(config: SandboxConfig | undefined, mode: SandboxMode | undefined): SandboxConfig | undefined;
//# sourceMappingURL=policy.d.ts.map