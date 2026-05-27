// Permission rule matcher — two glob syntaxes.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9
//
// Syntax 1: subcommand match    `Tool(arg:*)`     `Bash(git diff:*)`
// Syntax 2: prefix match        `Tool(arg *)`     `Bash(npm test *)`
// Syntax 3: domain match        `Tool(domain:x)`  `WebFetch(domain:github.com)`
// Bare tool:                    `Tool`            `Read` (any args allowed)
//
// Examples:
//   `Bash(git diff:*)`     matches `git diff`, `git diff --stat`, `git diff src/`
//                          does NOT match `git push`, `git pull`
//   `Bash(npm test *)`     matches `npm test`, `npm test -- --watch`, `npm tests run`
//   `WebFetch(domain:github.com)` matches WebFetch to github.com (subdomain not auto-included)
//   `Read`                 matches every Read call regardless of input

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
export function evaluatePermission(
  req: PermissionRequest,
  rules: PermissionRules | undefined,
): PermissionVerdict {
  if (!rules) return 'no-match';
  if (rules.deny?.some((p) => matchRule(p, req))) return 'deny';
  if (rules.ask?.some((p) => matchRule(p, req))) return 'ask';
  if (rules.allow?.some((p) => matchRule(p, req))) return 'allow';
  return 'no-match';
}

/**
 * Test a single rule pattern against a request.
 * Exported for unit testing — production code should call `evaluatePermission`.
 */
export function matchRule(pattern: string, req: PermissionRequest): boolean {
  const parsed = parseRule(pattern);
  if (!parsed) return false;
  if (parsed.tool !== req.tool) return false;

  if (parsed.kind === 'bare') return true;
  if (parsed.kind === 'subcommand') return matchSubcommand(parsed.spec, req.input);
  if (parsed.kind === 'prefix') return matchPrefix(parsed.spec, req.input);
  if (parsed.kind === 'domain') return matchDomain(parsed.spec, req.input);
  return false;
}

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
export function parseRule(pattern: string): ParsedRule | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;

  // Bare: no parens
  if (!trimmed.includes('(')) {
    return { tool: trimmed, kind: 'bare', spec: '' };
  }

  const openIdx = trimmed.indexOf('(');
  if (!trimmed.endsWith(')')) return null;
  const tool = trimmed.slice(0, openIdx);
  const inner = trimmed.slice(openIdx + 1, -1);

  if (inner.startsWith('domain:')) {
    return { tool, kind: 'domain', spec: inner.slice('domain:'.length) };
  }

  // Subcommand: `arg:*` (no leading wildcard, ends with `:*`)
  if (inner.endsWith(':*') && !inner.startsWith(':')) {
    return { tool, kind: 'subcommand', spec: inner.slice(0, -2) };
  }

  // Prefix: ends with " *" or is just "*"
  if (inner === '*') {
    return { tool, kind: 'prefix', spec: '' };
  }
  if (inner.endsWith(' *')) {
    return { tool, kind: 'prefix', spec: inner.slice(0, -2) + ' ' };
  }

  // Exact: `Tool(foo)` matches when the primary input equals foo exactly
  return { tool, kind: 'prefix', spec: inner }; // exact-as-prefix-with-no-trailing
}

/** Subcommand match: the FIRST space-separated token of the primary input must equal spec. */
function matchSubcommand(spec: string, input: Record<string, unknown>): boolean {
  const primary = primaryInput(input);
  if (!primary) return false;
  // Special case: "git diff" — match if primary starts with "git diff" followed by space/EOL
  // We allow multi-token spec ("git diff" matches "git diff --stat")
  return primary === spec || primary.startsWith(spec + ' ');
}

function matchPrefix(spec: string, input: Record<string, unknown>): boolean {
  const primary = primaryInput(input);
  if (!primary) return false;
  if (spec === '') return true; // (*) matches any
  return primary === spec.trimEnd() || primary.startsWith(spec);
}

function matchDomain(spec: string, input: Record<string, unknown>): boolean {
  const url = typeof input.url === 'string' ? input.url : '';
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === spec.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * The "primary" input field for a tool — for Bash it's `command`, for WebFetch it's `url`,
 * for Read/Write/Edit it's `file_path`. Falls back to whichever field is a string.
 */
export function primaryInput(input: Record<string, unknown>): string | null {
  const candidates = ['command', 'url', 'file_path', 'pattern', 'path'];
  for (const c of candidates) {
    if (typeof input[c] === 'string') return input[c] as string;
  }
  for (const v of Object.values(input)) {
    if (typeof v === 'string') return v;
  }
  return null;
}
