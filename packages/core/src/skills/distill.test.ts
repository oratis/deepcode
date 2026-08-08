import { describe, expect, it } from 'vitest';
import { parseFileContract } from '../config/file-contract.js';
import { parseFrontmatter } from './frontmatter.js';
import { distillSkill, sanitizeName } from './distill.js';
import type { StoredMessage } from '../types.js';

const CWD = '/work/repo';

function user(text: string): StoredMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp: '2026-08-08T00:00:00.000Z' };
}

function assistantToolUse(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
): StoredMessage {
  return {
    role: 'assistant',
    content: calls.map((c, i) => ({
      type: 'tool_use' as const,
      id: `t-${i}`,
      name: c.name,
      input: c.input,
    })),
    timestamp: '2026-08-08T00:00:01.000Z',
  };
}

describe('distillSkill', () => {
  it('derives allowed-tools from what the thread actually called', () => {
    // The least-privilege win: a hand-written skill would almost certainly list
    // more than this, because guessing generously is easier than auditing.
    const skill = distillSkill({
      cwd: CWD,
      history: [
        user('fix the auth bug'),
        assistantToolUse([
          { name: 'Read', input: { file_path: 'src/auth.ts' } },
          { name: 'Edit', input: { file_path: 'src/auth.ts' } },
          { name: 'Read', input: { file_path: 'src/auth.ts' } },
        ]),
      ],
    });
    expect(skill.allowedTools).toEqual(['Edit', 'Read']);
    expect(skill.allowedTools).not.toContain('Bash');
  });

  it('produces frontmatter the existing skills loader can parse', () => {
    // A draft the loader rejects is worthless, so this asserts against the real
    // parser rather than a regex.
    const skill = distillSkill({
      cwd: CWD,
      history: [user('fix the auth bug'), assistantToolUse([{ name: 'Read', input: {} }])],
      model: 'deepseek-chat',
      effort: 'high',
    });
    const { fields } = parseFrontmatter(skill.content);
    expect(fields.name).toBe(skill.name);
    expect(fields.description).toBeTruthy();
    expect(fields['allowed-tools']).toEqual(['Read']);
    expect(fields.model).toBe('deepseek-chat');
    expect(fields.effort).toBe('high');
  });

  it('marks the draft as needing review', () => {
    const skill = distillSkill({ cwd: CWD, history: [user('do a thing')] });
    expect(skill.content).toContain('TODO: review before use');
  });

  it('names the skill from the request when none is given', () => {
    const skill = distillSkill({ cwd: CWD, history: [user('Fix the auth bug in prod!')] });
    expect(skill.name).toBe('fix-the-auth-bug');
  });

  it('honours an explicit name, sanitized', () => {
    const skill = distillSkill({ cwd: CWD, history: [user('x')], name: 'My Cool Skill!' });
    expect(skill.name).toBe('my-cool-skill');
  });

  it('records the files involved, workspace-relative', () => {
    const skill = distillSkill({
      cwd: CWD,
      history: [
        user('go'),
        assistantToolUse([{ name: 'Edit', input: { file_path: '/work/repo/src/a.ts' } }]),
      ],
    });
    expect(skill.paths).toEqual(['src/a.ts']);
  });

  describe('what it refuses to carry into a shareable file', () => {
    it('excludes paths the contract denies reading', () => {
      // A rule that stops at the tool call but not at the export is not much of
      // a rule — the filename alone leaks.
      const contract = parseFileContract(
        'version: 1\nrules:\n  - glob: "**/.env*"\n    read: deny\n',
      );
      const skill = distillSkill({
        cwd: CWD,
        contract,
        history: [
          user('go'),
          assistantToolUse([
            { name: 'Read', input: { file_path: '.env' } },
            { name: 'Read', input: { file_path: 'src/a.ts' } },
          ]),
        ],
      });
      expect(skill.paths).toEqual(['src/a.ts']);
      expect(skill.content).not.toContain('.env');
      expect(skill.redactions.join(' ')).toContain('file contract');
    });

    it.each([
      ['API key', 'here is sk-abcdefghijklmnopqrstuvwxyz012345'],
      ['GitHub token', 'use ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
      ['AWS access key id', 'AKIAIOSFODNN7EXAMPLE is the id'],
      ['credential assignment', 'password: hunter2correcthorse'],
      ['private key', '-----BEGIN RSA PRIVATE KEY-----'],
    ])('redacts a %s from the request text', (_label, secret) => {
      const skill = distillSkill({ cwd: CWD, history: [user(secret)] });
      expect(skill.content).toContain('[REDACTED]');
      expect(skill.redactions.length).toBeGreaterThan(0);
    });

    it('names what it withheld, so the user is not guessing', () => {
      const skill = distillSkill({
        cwd: CWD,
        history: [user('key sk-abcdefghijklmnopqrstuvwxyz012345')],
      });
      expect(skill.redactions.join(' ')).toContain('API key');
    });

    it('ignores paths outside the workspace', () => {
      const skill = distillSkill({
        cwd: CWD,
        history: [
          user('go'),
          assistantToolUse([{ name: 'Read', input: { file_path: '/etc/passwd' } }]),
        ],
      });
      expect(skill.paths).toEqual([]);
    });
  });

  it('uses model prose when supplied, and still redacts it', () => {
    const skill = distillSkill({
      cwd: CWD,
      history: [user('go')],
      prose: { description: 'Nice summary', body: 'token: ghp_abcdefghijklmnopqrstuvwxyz01' },
    });
    expect(skill.content).toContain('Nice summary');
    expect(skill.content).toContain('[REDACTED]');
  });

  it('falls back to a useful deterministic body without a model', () => {
    // The fallback is a real draft, not a placeholder: the step sequence and
    // touched files are recoverable exactly, and they are what a reader needs.
    const skill = distillSkill({
      cwd: CWD,
      history: [
        user('fix the auth bug'),
        assistantToolUse([
          { name: 'Read', input: { file_path: 'src/auth.ts' } },
          { name: 'Edit', input: { file_path: 'src/auth.ts' } },
        ]),
      ],
    });
    expect(skill.content).toContain('Steps taken');
    expect(skill.content).toContain('Read');
    expect(skill.content).toContain('`src/auth.ts`');
  });

  it('handles an empty thread without throwing', () => {
    const skill = distillSkill({ cwd: CWD, history: [] });
    expect(skill.name).toBe('untitled-combo');
    expect(skill.allowedTools).toEqual([]);
  });
});

describe('sanitizeName', () => {
  it.each([
    ['My Skill', 'my-skill'],
    ['../../etc/passwd', 'etc-passwd'],
    ['a/b/c', 'a-b-c'],
    ['---', 'untitled-combo'],
    ['', 'untitled-combo'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeName(input)).toBe(expected);
  });

  it('never produces a path separator or traversal', () => {
    // The name becomes a directory under .deepcode/skills/.
    for (const hostile of ['../escape', 'a/../../b', './x']) {
      const out = sanitizeName(hostile);
      expect(out).not.toContain('/');
      expect(out).not.toContain('..');
    }
  });
});
