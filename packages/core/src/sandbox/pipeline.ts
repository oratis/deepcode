// Pipeline analysis — looks at a shell command string and breaks it into
// distinct clauses connected by `&&`, `||`, `;`, or `|`. Useful for hardening
// excluded-command bypass so `git status && rm -rf /` does NOT bypass.
// Spec: docs/security-model.md (M3.5-ext gap)
//
// This is intentionally minimal — we don't aim for full POSIX shell parsing.
// We do honor single quotes, double quotes, and backslash escapes when
// scanning, so a literal `&&` inside a string doesn't count.

export interface Clause {
  command: string;
  /** Index in the original string where the clause starts. */
  start: number;
  /** Operator that came BEFORE this clause (empty for first clause). */
  precedingOp: '' | '&&' | '||' | ';' | '|';
}

export function splitClauses(input: string): Clause[] {
  const clauses: Clause[] = [];
  let i = 0;
  let buf = '';
  let clauseStart = 0;
  let precedingOp: Clause['precedingOp'] = '';
  let inSingle = false;
  let inDouble = false;
  while (i < input.length) {
    const ch = input[i]!;
    const next = input[i + 1] ?? '';

    if (!inSingle && !inDouble && ch === '\\') {
      buf += ch + next;
      i += 2;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      buf += ch;
      i++;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      buf += ch;
      i++;
      continue;
    }
    if (inSingle || inDouble) {
      buf += ch;
      i++;
      continue;
    }
    // Two-char operators
    if (ch === '&' && next === '&') {
      pushClause();
      precedingOp = '&&';
      i += 2;
      continue;
    }
    if (ch === '|' && next === '|') {
      pushClause();
      precedingOp = '||';
      i += 2;
      continue;
    }
    // Single-char
    if (ch === ';') {
      pushClause();
      precedingOp = ';';
      i++;
      continue;
    }
    if (ch === '|') {
      pushClause();
      precedingOp = '|';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  pushClause();
  return clauses;

  function pushClause(): void {
    const trimmed = buf.trim();
    if (trimmed.length > 0) {
      clauses.push({ command: trimmed, start: clauseStart, precedingOp });
    }
    buf = '';
    clauseStart = i + 1;
  }
}

/**
 * Returns true if EVERY clause's leading token (the command name) appears in
 * the excluded list. If ANY clause has a non-excluded leader, return false —
 * the call must be sandboxed.
 *
 * This is the right semantics for the "excluded command" bypass: the entire
 * pipeline must be excluded, not just the first clause.
 */
export function allClausesExcluded(input: string, excluded: string[]): boolean {
  if (excluded.length === 0) return false;
  const clauses = splitClauses(input);
  if (clauses.length === 0) return false;
  return clauses.every((c) => {
    const leader = c.command.split(/\s+/)[0] ?? '';
    return excluded.includes(leader);
  });
}
