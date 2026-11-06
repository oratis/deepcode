import type { PermissionRules } from './types.js';
export type PermissionVerdict = 'allow' | 'ask' | 'deny' | 'no-match';
export interface PermissionRequest {
    tool: string;
    /** Tool input — schema-shaped (e.g. { command: "git push" } for Bash). */
    input: Record<string, unknown>;
}
/**
 * Evaluate a tool call against settings.json permission rules.
 * Precedence: deny > ask > allow. (Most restrictive wins; defaults to no-match.)
 */
export declare function evaluatePermission(req: PermissionRequest, rules: PermissionRules | undefined): PermissionVerdict;
/**
 * Test a single rule pattern against a request.
 * Exported for unit testing — production code should call `evaluatePermission`.
 */
export declare function matchRule(pattern: string, req: PermissionRequest): boolean;
interface ParsedRule {
    tool: string;
    kind: 'bare' | 'subcommand' | 'prefix' | 'domain';
    spec: string;
}
/**
 * Parse a permission rule. Returns null if the pattern is malformed.
 *
 * Cases:
 *   `Tool`              → { kind: 'bare' }
 *   `Tool(domain:x)`    → { kind: 'domain', spec: 'x' }
 *   `Tool(foo:*)`       → { kind: 'subcommand', spec: 'foo' }
 *   `Tool(foo *)`       → { kind: 'prefix', spec: 'foo ' }
 *   `Tool(*)`           → { kind: 'prefix', spec: '' }
 */
export declare function parseRule(pattern: string): ParsedRule | null;
/**
 * The "primary" input field for a tool — for Bash it's `command`, for WebFetch it's `url`,
 * for Read/Write/Edit it's `file_path`. Falls back to whichever field is a string.
 */
export declare function primaryInput(input: Record<string, unknown>): string | null;
export {};
//# sourceMappingURL=permissions.d.ts.map