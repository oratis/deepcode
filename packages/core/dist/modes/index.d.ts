import type { Mode } from '../types.js';
export interface ModeRequest {
    tool: string;
    input: Record<string, unknown>;
    /** Result of evaluatePermission() — most-restrictive of allow/ask/deny/no-match. */
    permissionVerdict: 'allow' | 'ask' | 'deny' | 'no-match';
}
export type ModeVerdict = 'allow' | 'ask' | 'deny' | 'plan-blocked';
export declare function isPermissiveMode(mode: Mode): boolean;
export declare function evaluateMode(mode: Mode, req: ModeRequest): ModeVerdict;
/** Pretty label for a verdict — useful in error messages / UI. */
export declare function modeVerdictReason(mode: Mode, verdict: ModeVerdict, tool: string): string;
//# sourceMappingURL=index.d.ts.map