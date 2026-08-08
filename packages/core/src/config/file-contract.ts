// File contract — permission rules on the *path* axis.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.A
//
// `permissions.ts` answers "may the agent call this tool with these arguments".
// It cannot answer "may the agent read this file", because its only path-aware
// match is a prefix compare against `primaryInput()`, and a real `file_path` is
// usually absolute — so `Read(.env*)` matches nothing. This file adds the
// missing axis: glob × {read, write, execute} × {allow, ask, deny}.
//
// Two properties the rest of the system depends on:
//
//   1. The verdict type is `PermissionVerdict`, the same lattice the tool rules
//      already produce, so composing them needs no new vocabulary.
//   2. Evaluation is pure. Loading touches the filesystem; deciding does not,
//      which is what makes the decision table exhaustively testable.
//
// Deliberately NOT a security boundary. A contract constrains tool calls that
// go through the dispatcher; it says nothing about what a shell command does
// once Bash has started. Only the sandbox constrains that.

import { isAbsolute, relative, resolve } from 'node:path';
import type { PermissionVerdict } from './permissions.js';

export type ContractAction = 'read' | 'write' | 'execute';
export type ContractDecision = 'allow' | 'ask' | 'deny';
/** Responsibility, not access control — it shapes wording and conflict handling. */
export type ContractOwner = 'human' | 'agent' | 'shared';

const ACTIONS: readonly ContractAction[] = ['read', 'write', 'execute'];
const DECISIONS: readonly string[] = ['allow', 'ask', 'deny'];
const OWNERS: readonly string[] = ['human', 'agent', 'shared'];

export interface FileContractRule {
  glob: string;
  owner?: ContractOwner;
  read?: ContractDecision;
  write?: ContractDecision;
  execute?: ContractDecision;
  /** Shown verbatim when this rule produces an `ask` or `deny`. */
  reason?: string;
}

export interface FileContract {
  version: 1;
  defaults: Record<ContractAction, ContractDecision>;
  rules: FileContractRule[];
}

/** Applied when a contract declares no `defaults` block. */
export const DEFAULT_CONTRACT_DEFAULTS: Record<ContractAction, ContractDecision> = {
  read: 'allow',
  write: 'allow',
  execute: 'allow',
};

/**
 * Paths the contract may never widen, enforced regardless of file content.
 *
 * A contract that can grant itself `write: allow` is not a contract — the first
 * thing an agent talked into editing it would do is remove its own limits.
 */
const IMMUTABLE_DENY_WRITE = ['.deepcode/file-contract.yaml', '.deepcode/file-contract.yml'];

export class FileContractError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = 'FileContractError';
  }
}

// ── Evaluation ──────────────────────────────────────────────────────────

export interface ContractRequest {
  /** Workspace-relative POSIX path, from `normalizeContractPath`. */
  path: string;
  action: ContractAction;
}

export interface ContractEvaluation {
  verdict: PermissionVerdict;
  /** The glob that decided, absent when the answer came from `defaults`. */
  rule?: string;
  /** Author-supplied explanation, surfaced to the user on ask/deny. */
  reason?: string;
}

/**
 * Decide one (path, action) pair. Pure.
 *
 * Precedence follows the contract's own stated rule: the more specific glob
 * wins, and equal specificity resolves to the later rule — so a broad default
 * near the top can be narrowed further down without reordering the file.
 */
export function evaluatePath(
  contract: FileContract | undefined,
  req: ContractRequest,
): ContractEvaluation {
  if (!contract) return { verdict: 'no-match' };

  // Self-protection beats everything, including a rule that says otherwise.
  if (req.action === 'write' && IMMUTABLE_DENY_WRITE.includes(req.path)) {
    return {
      verdict: 'deny',
      rule: req.path,
      reason: 'The file contract cannot amend itself.',
    };
  }

  let best: { rule: FileContractRule; rank: SpecificityRank } | undefined;
  for (const rule of contract.rules) {
    if (rule[req.action] === undefined) continue;
    if (!globMatches(rule.glob, req.path)) continue;
    const rank = specificity(rule.glob);
    // `>= 0` (not `> 0`) is what makes "later wins" true on a tie.
    if (!best || compareSpecificity(rank, best.rank) >= 0) best = { rule, rank };
  }

  if (best) {
    const decision = best.rule[req.action]!;
    return {
      verdict: decision,
      rule: best.rule.glob,
      ...(best.rule.reason ? { reason: best.rule.reason } : {}),
    };
  }
  return { verdict: contract.defaults[req.action] };
}

/**
 * Express `filePath` as a workspace-relative POSIX path, or null when it falls
 * outside the workspace.
 *
 * Outside paths are the sandbox's problem, not the contract's: a contract is a
 * per-project document and has no authority over `/etc`. Returning null keeps
 * `evaluatePath` from inventing an opinion it cannot justify.
 *
 * Pure string math — no `realpath`. A symlink inside the workspace pointing out
 * of it still normalizes to an inside-looking path. See the module header: the
 * sandbox is the boundary, this is policy.
 */
export function normalizeContractPath(cwd: string, filePath: string): string | null {
  if (!filePath) return null;
  const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
  const rel = relative(resolve(cwd), abs);
  if (rel === '') return null; // the workspace root itself
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(/[/\\]+/).join('/');
}

// ── Glob matching ───────────────────────────────────────────────────────

/**
 * Supported syntax: `*` (within a segment), `**` (across segments), `?`, and
 * `{a,b}` alternation. Intentionally small — every construct here has to be
 * explainable in the docs, and a contract nobody can read is a contract nobody
 * audits.
 */
export function globMatches(glob: string, path: string): boolean {
  let re = globRegexCache.get(glob);
  if (!re) {
    re = new RegExp(`^${globToRegexSource(glob)}$`);
    globRegexCache.set(glob, re);
  }
  return re.test(path);
}

const globRegexCache = new Map<string, RegExp>();

function globToRegexSource(glob: string): string {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === '*') {
      const isDouble = glob[i + 1] === '*';
      if (isDouble) {
        // `a/**/b` must also match `a/b`, so consume the trailing slash and
        // make the whole "slash plus segments" group optional.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 3;
          continue;
        }
        out += '.*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        out += '\\{';
        i += 1;
        continue;
      }
      const alternatives = glob.slice(i + 1, close).split(',');
      out += `(?:${alternatives.map(globToRegexSource).join('|')})`;
      i = close + 1;
      continue;
    }
    out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return out;
}

type SpecificityRank = { doubleStars: number; segments: number; literals: number };

/**
 * Rank a glob so "more specific" is decidable without asking the author to
 * order the file carefully.
 *
 * Fewer `**` beats more (`src/*.ts` over `**\/*.ts`); then more path segments
 * beats fewer (`src/a/**` over `src/**`); then more literal characters beats
 * fewer (`**\/.env*` over `**\/*`).
 */
export function specificity(glob: string): SpecificityRank {
  const segments = glob.split('/');
  return {
    doubleStars: segments.filter((s) => s.includes('**')).length,
    segments: segments.length,
    literals: glob.replace(/[*?{},]/g, '').length,
  };
}

function compareSpecificity(a: SpecificityRank, b: SpecificityRank): number {
  if (a.doubleStars !== b.doubleStars) return b.doubleStars - a.doubleStars;
  if (a.segments !== b.segments) return a.segments - b.segments;
  return a.literals - b.literals;
}

// ── Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse the contract's YAML subset.
 *
 * The repo carries no YAML dependency on purpose (see `skills/frontmatter.ts`),
 * and a contract file has exactly one shape, so a focused strict parser beats
 * a general permissive one: anything it does not recognise throws instead of
 * being dropped. A silently-ignored `deny` line is the worst possible failure
 * for this particular file.
 */
export function parseFileContract(raw: string): FileContract {
  const lines = raw.split(/\r?\n/);
  let version: number | undefined;
  const defaults: Partial<Record<ContractAction, ContractDecision>> = {};
  const rules: FileContractRule[] = [];

  type Section = 'top' | 'defaults' | 'rules';
  let section: Section = 'top';
  let current: FileContractRule | undefined;

  for (let n = 0; n < lines.length; n++) {
    const rawLine = stripComment(lines[n]!);
    if (rawLine.trim() === '') continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    const lineNo = n + 1;

    if (indent === 0) {
      current = undefined;
      const kv = splitKeyValue(line, lineNo);
      switch (kv.key) {
        case 'version': {
          const parsed = Number(kv.value);
          if (!Number.isInteger(parsed)) {
            throw new FileContractError(`version must be an integer, got "${kv.value}"`, lineNo);
          }
          version = parsed;
          section = 'top';
          continue;
        }
        case 'defaults':
          requireEmptyValue(kv.value, 'defaults', lineNo);
          section = 'defaults';
          continue;
        case 'rules':
          requireEmptyValue(kv.value, 'rules', lineNo);
          section = 'rules';
          continue;
        default:
          throw new FileContractError(`unknown top-level key "${kv.key}"`, lineNo);
      }
    }

    if (section === 'defaults') {
      const kv = splitKeyValue(line, lineNo);
      if (!isAction(kv.key)) {
        throw new FileContractError(
          `unknown default "${kv.key}" (expected read/write/execute)`,
          lineNo,
        );
      }
      defaults[kv.key] = requireDecision(kv.value, kv.key, lineNo);
      continue;
    }

    if (section === 'rules') {
      const isItemStart = line.startsWith('- ');
      const body = isItemStart ? line.slice(2).trim() : line;
      if (isItemStart) {
        current = { glob: '' };
        rules.push(current);
      }
      if (!current) throw new FileContractError('rule field outside any rule item', lineNo);
      const kv = splitKeyValue(body, lineNo);
      applyRuleField(current, kv.key, kv.value, lineNo);
      continue;
    }

    throw new FileContractError(`unexpected indented line under "${section}"`, lineNo);
  }

  if (version === undefined) throw new FileContractError('missing required key "version"');
  if (version !== 1) throw new FileContractError(`unsupported version ${version} (expected 1)`);
  for (const [index, rule] of rules.entries()) {
    if (!rule.glob) throw new FileContractError(`rule #${index + 1} is missing "glob"`);
    if (!ACTIONS.some((a) => rule[a] !== undefined) && !rule.owner) {
      throw new FileContractError(
        `rule "${rule.glob}" sets no read/write/execute decision and no owner, so it does nothing`,
      );
    }
  }

  return { version: 1, defaults: { ...DEFAULT_CONTRACT_DEFAULTS, ...defaults }, rules };
}

function applyRuleField(rule: FileContractRule, key: string, value: string, lineNo: number): void {
  if (key === 'glob') {
    if (!value) throw new FileContractError('glob must not be empty', lineNo);
    rule.glob = value;
    return;
  }
  if (key === 'reason') {
    rule.reason = value;
    return;
  }
  if (key === 'owner') {
    if (!OWNERS.includes(value)) {
      throw new FileContractError(
        `owner must be one of ${OWNERS.join('/')}, got "${value}"`,
        lineNo,
      );
    }
    rule.owner = value as ContractOwner;
    return;
  }
  if (isAction(key)) {
    rule[key] = requireDecision(value, key, lineNo);
    return;
  }
  throw new FileContractError(`unknown rule field "${key}"`, lineNo);
}

function isAction(key: string): key is ContractAction {
  return (ACTIONS as readonly string[]).includes(key);
}

function requireDecision(value: string, key: string, lineNo: number): ContractDecision {
  if (!DECISIONS.includes(value)) {
    throw new FileContractError(
      `${key} must be one of ${DECISIONS.join('/')}, got "${value}"`,
      lineNo,
    );
  }
  return value as ContractDecision;
}

function requireEmptyValue(value: string, key: string, lineNo: number): void {
  if (value !== '')
    throw new FileContractError(`"${key}" takes a nested block, not a value`, lineNo);
}

function splitKeyValue(line: string, lineNo: number): { key: string; value: string } {
  const idx = line.indexOf(':');
  if (idx === -1) throw new FileContractError(`expected "key: value", got "${line}"`, lineNo);
  const key = line.slice(0, idx).trim();
  if (!key) throw new FileContractError(`empty key in "${line}"`, lineNo);
  return { key, value: unquote(line.slice(idx + 1).trim()) };
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Drop a trailing `#` comment, leaving `#` inside quotes alone. */
function stripComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    // Only a `#` that starts a token is a comment, so `a#b` stays intact.
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}
