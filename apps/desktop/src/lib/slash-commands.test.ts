import { describe, expect, it } from 'vitest';
import {
  DESKTOP_COMMANDS,
  filterCommands,
  formatWorkspaceDiff,
  helpText,
  parseSlash,
} from './slash-commands.js';

describe('filterCommands', () => {
  it('suggests nothing for ordinary prose', () => {
    expect(filterCommands('what does this do?')).toEqual([]);
  });

  it('lists everything for a bare slash', () => {
    expect(filterCommands('/')).toHaveLength(DESKTOP_COMMANDS.length);
  });

  it('narrows by prefix', () => {
    expect(filterCommands('/mo').map((c) => c.name)).toEqual(['/model', '/mode']);
  });

  it('is case-insensitive', () => {
    expect(filterCommands('/MO').map((c) => c.name)).toEqual(['/model', '/mode']);
  });

  it('stops suggesting once the user is typing an argument', () => {
    expect(filterCommands('/effort ')).toEqual([]);
    expect(filterCommands('/effort hi')).toEqual([]);
  });

  it('stops at the first space, even mid-word', () => {
    expect(filterCommands('/mo del')).toEqual([]);
    expect(filterCommands('/ something')).toEqual([]);
  });
});

describe('parseSlash', () => {
  it('leaves prose alone so it reaches the model', () => {
    expect(parseSlash('fix the bug')).toBeNull();
    expect(parseSlash('  path/to/file')).toBeNull();
  });

  it('resolves the no-argument commands', () => {
    expect(parseSlash('/help')).toEqual({ kind: 'help' });
    expect(parseSlash('/clear')).toEqual({ kind: 'clear' });
    expect(parseSlash('/cost')).toEqual({ kind: 'cost' });
    expect(parseSlash('/context')).toEqual({ kind: 'context' });
    expect(parseSlash('/diff')).toEqual({ kind: 'diff' });
  });

  it('routes the screen commands', () => {
    expect(parseSlash('/mcp')).toEqual({ kind: 'navigate', screen: 'mcp' });
    expect(parseSlash('/about')).toEqual({ kind: 'navigate', screen: 'about' });
  });

  it('accepts valid arguments', () => {
    expect(parseSlash('/model deepseek-reasoner')).toEqual({
      kind: 'set-model',
      value: 'deepseek-reasoner',
    });
    expect(parseSlash('/mode plan')).toEqual({ kind: 'set-mode', value: 'plan' });
    expect(parseSlash('/effort max')).toEqual({ kind: 'set-effort', value: 'max' });
  });

  it('/plan enters plan mode, /plan off leaves, a trailing prompt is refused', () => {
    expect(parseSlash('/plan')).toEqual({ kind: 'set-mode', value: 'plan' });
    expect(parseSlash('/plan off')).toEqual({ kind: 'set-mode', value: 'default' });
    const r = parseSlash('/plan refactor auth');
    expect(r?.kind).toBe('error');
    expect(r && 'message' in r && r.message).toContain('takes no prompt');
  });

  it('rejects an invalid argument with the usage line, not silently', () => {
    const r = parseSlash('/effort ludicrous');
    expect(r?.kind).toBe('error');
    expect(r && 'message' in r && r.message).toContain('low');
  });

  it('rejects a missing argument', () => {
    expect(parseSlash('/model')?.kind).toBe('error');
  });

  it('names an unknown command instead of sending it to the model', () => {
    const r = parseSlash('/nope');
    expect(r?.kind).toBe('error');
    expect(r && 'message' in r && r.message).toContain('/nope');
  });

  it('tolerates surrounding whitespace and case', () => {
    expect(parseSlash('  /MODE  plan  ')).toEqual({ kind: 'set-mode', value: 'plan' });
  });
});

describe('helpText', () => {
  it('lists every catalogued command', () => {
    const text = helpText();
    for (const c of DESKTOP_COMMANDS) expect(text).toContain(c.name);
  });

  it('says where the host-only commands live rather than pretending they exist', () => {
    expect(helpText()).toContain('CLI-only');
  });
});

describe('formatWorkspaceDiff', () => {
  const file = (path: string, additions: number, deletions: number) => ({
    path,
    status: 'modified',
    additions,
    deletions,
  });

  it('reports a clean tree', () => {
    expect(
      formatWorkspaceDiff({ repository: true, base: 'HEAD', files: [], truncated: false }),
    ).toBe('Working tree clean.');
  });

  it('says when there is no repository at all', () => {
    expect(
      formatWorkspaceDiff({ repository: false, base: null, files: [], truncated: false }),
    ).toContain('Not a Git repository');
  });

  it('totals the changes across files', () => {
    const out = formatWorkspaceDiff({
      repository: true,
      base: 'HEAD',
      files: [file('src/a.ts', 3, 1), file('src/b.ts', 10, 0)],
      truncated: false,
    });
    expect(out).toContain('2 changed files (+13 -1)');
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
  });

  it('uses the singular for one file', () => {
    const out = formatWorkspaceDiff({
      repository: true,
      base: 'HEAD',
      files: [file('src/a.ts', 1, 1)],
      truncated: false,
    });
    expect(out).toContain('1 changed file (');
  });

  it('discloses truncation', () => {
    const out = formatWorkspaceDiff({
      repository: true,
      base: 'HEAD',
      files: [file('src/a.ts', 1, 1)],
      truncated: true,
    });
    expect(out).toContain('truncated');
  });
});
