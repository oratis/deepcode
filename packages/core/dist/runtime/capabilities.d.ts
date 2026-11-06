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
export declare const ALWAYS_CONFIRMED_ACTIONS: readonly ["ledger.rollback", "plugin.install", "contract.change", "trust.grant"];
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
        ruleCounts: {
            allow: number;
            ask: number;
            deny: number;
        };
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
    ledger?: {
        enabled: boolean;
        path: string;
    };
    modules?: Record<string, boolean>;
}
/**
 * Build the declaration. Pure, so two hosts given the same settings produce
 * byte-identical output — that equality is the point, and it is asserted in
 * tests rather than assumed.
 */
export declare function buildRuntimeCapabilities(input: BuildRuntimeCapabilitiesInput): RuntimeCapabilities;
//# sourceMappingURL=capabilities.d.ts.map