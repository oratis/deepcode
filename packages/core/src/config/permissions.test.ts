import { describe, expect, it } from 'vitest';
import { evaluatePermission, matchRule, parseRule, primaryInput } from './permissions.js';

describe('parseRule', () => {
  it('parses bare tool', () => {
    expect(parseRule('Read')).toEqual({ tool: 'Read', kind: 'bare', spec: '' });
  });
  it('parses subcommand pattern', () => {
    expect(parseRule('Bash(git diff:*)')).toEqual({
      tool: 'Bash',
      kind: 'subcommand',
      spec: 'git diff',
    });
  });
  it('parses prefix pattern', () => {
    expect(parseRule('Bash(npm test *)')).toEqual({
      tool: 'Bash',
      kind: 'prefix',
      spec: 'npm test ',
    });
  });
  it('parses wildcard-only prefix', () => {
    expect(parseRule('Bash(*)')).toEqual({ tool: 'Bash', kind: 'prefix', spec: '' });
  });
  it('parses domain pattern', () => {
    expect(parseRule('WebFetch(domain:github.com)')).toEqual({
      tool: 'WebFetch',
      kind: 'domain',
      spec: 'github.com',
    });
  });
  it('returns null on empty input', () => {
    expect(parseRule('')).toBeNull();
  });
  it('returns null on unbalanced parens', () => {
    expect(parseRule('Bash(unbalanced')).toBeNull();
  });
});

describe('matchRule', () => {
  it('bare tool matches any args', () => {
    expect(matchRule('Read', { tool: 'Read', input: { file_path: '/x' } })).toBe(true);
    expect(matchRule('Read', { tool: 'Write', input: { file_path: '/x' } })).toBe(false);
  });

  describe('subcommand: Bash(git diff:*)', () => {
    const pat = 'Bash(git diff:*)';
    it('matches exact "git diff"', () => {
      expect(matchRule(pat, { tool: 'Bash', input: { command: 'git diff' } })).toBe(true);
    });
    it('matches "git diff --stat"', () => {
      expect(matchRule(pat, { tool: 'Bash', input: { command: 'git diff --stat' } })).toBe(true);
    });
    it('matches "git diff src/"', () => {
      expect(matchRule(pat, { tool: 'Bash', input: { command: 'git diff src/' } })).toBe(true);
    });
    it('does NOT match "git push"', () => {
      expect(matchRule(pat, { tool: 'Bash', input: { command: 'git push' } })).toBe(false);
    });
    it('does NOT match "git diffx"', () => {
      expect(matchRule(pat, { tool: 'Bash', input: { command: 'git diffx' } })).toBe(false);
    });
  });

  describe('prefix: Bash(npm test *)', () => {
    const pat = 'Bash(npm test *)';
    it('matches "npm test"', () => {
      expect(matchRule(pat, { tool: 'Bash', input: { command: 'npm test' } })).toBe(true);
    });
    it('matches "npm test -- --watch"', () => {
      expect(matchRule(pat, { tool: 'Bash', input: { command: 'npm test -- --watch' } })).toBe(
        true,
      );
    });
    it('does NOT match "npm run test"', () => {
      expect(matchRule(pat, { tool: 'Bash', input: { command: 'npm run test' } })).toBe(false);
    });
  });

  describe('domain: WebFetch(domain:github.com)', () => {
    const pat = 'WebFetch(domain:github.com)';
    it('matches https://github.com/x', () => {
      expect(matchRule(pat, { tool: 'WebFetch', input: { url: 'https://github.com/x' } })).toBe(
        true,
      );
    });
    it('does NOT match sub.github.com (no implicit wildcard)', () => {
      expect(matchRule(pat, { tool: 'WebFetch', input: { url: 'https://api.github.com/x' } })).toBe(
        false,
      );
    });
    it('does NOT match other host', () => {
      expect(matchRule(pat, { tool: 'WebFetch', input: { url: 'https://npmjs.com/x' } })).toBe(
        false,
      );
    });
    it('handles invalid URL gracefully', () => {
      expect(matchRule(pat, { tool: 'WebFetch', input: { url: 'not a url' } })).toBe(false);
    });
  });

  it('wildcard-only Bash(*) matches anything', () => {
    expect(matchRule('Bash(*)', { tool: 'Bash', input: { command: 'rm -rf /' } })).toBe(true);
  });
});

describe('evaluatePermission', () => {
  it('returns no-match without rules', () => {
    expect(evaluatePermission({ tool: 'Read', input: { file_path: '/x' } }, undefined)).toBe(
      'no-match',
    );
  });
  it('deny beats ask beats allow (most restrictive wins)', () => {
    const rules = {
      allow: ['Bash'],
      ask: ['Bash(git push *)'],
      deny: ['Bash(rm:*)'],
    };
    expect(evaluatePermission({ tool: 'Bash', input: { command: 'rm -rf foo' } }, rules)).toBe(
      'deny',
    );
    expect(evaluatePermission({ tool: 'Bash', input: { command: 'git push origin' } }, rules)).toBe(
      'ask',
    );
    expect(evaluatePermission({ tool: 'Bash', input: { command: 'ls' } }, rules)).toBe('allow');
  });

  it('matches in order: deny → ask → allow', () => {
    expect(
      evaluatePermission(
        { tool: 'Bash', input: { command: 'git push' } },
        { allow: ['Bash'], deny: ['Bash(git push:*)'] },
      ),
    ).toBe('deny');
  });
});

describe('primaryInput', () => {
  it('prefers command for Bash', () => {
    expect(primaryInput({ command: 'echo', extra: 'x' })).toBe('echo');
  });
  it('falls back to url', () => {
    expect(primaryInput({ url: 'https://x' })).toBe('https://x');
  });
  it('falls back to file_path', () => {
    expect(primaryInput({ file_path: 'a.ts' })).toBe('a.ts');
  });
  it('returns null when no string-valued field', () => {
    expect(primaryInput({ recursive: true, n: 5 })).toBeNull();
  });
});
