import type { PermissionRules, SandboxMode } from '../config/types.js';
import type { Mode } from '../types.js';
export interface TriggerProfile {
    /**
     * Permission mode for this job. Setting it is an explicit decision and is
     * honoured as-is — including a permissive value, which is the opt-in that
     * makes the clamp below safe to have.
     */
    mode?: Mode;
    /** Extra rules, applied so they can only tighten the ambient ones. */
    permissions?: PermissionRules;
    /** Sandbox for this job; only ever applied if it is stricter than ambient. */
    sandbox?: SandboxMode;
}
export interface ResolvedTriggerMode {
    mode: Mode;
    /**
     * True when a permissive ambient mode was reduced because the job did not ask
     * for it. Callers surface this — a silent clamp is as surprising as a silent
     * grant, just in the other direction.
     */
    clamped: boolean;
    ambient: Mode;
}
/**
 * The mode an unattended run should use.
 *
 * An explicit `profile.mode` always wins, including a permissive one. Otherwise
 * a permissive ambient mode is clamped to `default`: inheriting "never ask me"
 * into a context where nobody could be asked is not what the user chose, it is
 * what they forgot to reconsider.
 */
export declare function resolveTriggerMode(profile: TriggerProfile | undefined, ambient: Mode): ResolvedTriggerMode;
/**
 * Combine ambient rules with a profile's, tightening only.
 *
 * Denies and asks union — either source can add a restriction. Allows
 * intersect, so a profile can narrow what is auto-approved but never widen it.
 * This is the same one-way property the file contract has, for the same reason:
 * a mechanism that can only tighten cannot reduce existing safety, whatever the
 * user writes.
 */
export declare function tightenPermissions(ambient: PermissionRules | undefined, profile: PermissionRules | undefined): PermissionRules | undefined;
/** The stricter of the two sandbox modes; a profile can never loosen it. */
export declare function tightenSandbox(ambient: SandboxMode | undefined, profile: SandboxMode | undefined): SandboxMode | undefined;
/** Human-readable note for the job log when a clamp happens. */
export declare function describeClamp(resolved: ResolvedTriggerMode): string | undefined;
//# sourceMappingURL=profile.d.ts.map