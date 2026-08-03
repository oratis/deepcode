import { describe, expect, it } from 'vitest';
import {
  ThinkingStream,
  colorEnabled,
  makePalette,
  renderApprovalPreview,
  renderDiff,
  renderToolCall,
  renderToolResult,
  toolTarget,
} from './render.js';

const plain = makePalette(false);

describe('colorEnabled', () => {
  it('follows the TTY when nothing overrides it', () => {
    expect(colorEnabled({}, true)).toBe(true);
    expect(colorEnabled({}, false)).toBe(false);
  });

  it('NO_COLOR wins over everything, including FORCE_COLOR', () => {
    expect(colorEnabled({ NO_COLOR: '1', FORCE_COLOR: '1' }, true)).toBe(false);
    expect(colorEnabled({ NO_COLOR: 'anything' }, true)).toBe(false);
  });

  it('ignores an empty NO_COLOR, per the spec', () => {
    expect(colorEnabled({ NO_COLOR: '' }, true)).toBe(true);
  });

  it('FORCE_COLOR turns colour on for a pipe, and 0 turns it off', () => {
    expect(colorEnabled({ FORCE_COLOR: '1' }, false)).toBe(true);
    expect(colorEnabled({ FORCE_COLOR: '0' }, true)).toBe(false);
  });

  it('treats a dumb terminal as no colour', () => {
    expect(colorEnabled({ TERM: 'dumb' }, true)).toBe(false);
  });
});

describe('makePalette', () => {
  it('emits no escape bytes when disabled', () => {
    expect(plain.red('x')).toBe('x');
  });

  it('wraps and resets when enabled', () => {
    expect(makePalette(true).red('x')).toBe('\u001b[31mx\u001b[0m');
  });
});

describe('renderDiff', () => {
  it('marks additions and deletions with line numbers', () => {
    const out = renderDiff('a\nb\nc', 'a\nB\nc', plain);
    expect(out).toContain('- b');
    expect(out).toContain('+ B');
    expect(out).toContain('a');
  });

  it('collapses unchanged stretches instead of printing the whole file', () => {
    const before = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 100', 'line 100 CHANGED');
    const out = renderDiff(before, after, plain);
    expect(out).toContain('line 100 CHANGED');
    expect(out).toContain('⋯');
    // 1 del + 1 add + 4 context + a gap marker — nowhere near 200 rows.
    expect(out.trim().split('\n').length).toBeLessThan(12);
    expect(out).not.toContain('line 5');
  });

  it('caps a huge rewrite and says how much it withheld', () => {
    const before = Array.from({ length: 300 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 300 }, (_, i) => `new ${i}`).join('\n');
    const out = renderDiff(before, after, plain, { maxLines: 10 });
    expect(out.trim().split('\n').length).toBeLessThanOrEqual(11);
    expect(out).toMatch(/⋯ \d+ more changed lines/);
  });

  it('says so when the two revisions are identical', () => {
    expect(renderDiff('same\ntext', 'same\ntext', plain)).toContain('(no change)');
  });

  it('renders a brand-new file as pure additions', () => {
    const out = renderDiff('', 'hello\nworld', plain);
    expect(out).toContain('+ hello');
    expect(out).toContain('+ world');
    expect(out).not.toContain('- ');
  });
});

describe('renderToolCall', () => {
  it('leads with the file path for file tools', () => {
    expect(renderToolCall('Edit', { file_path: 'src/a.ts' }, plain)).toContain('src/a.ts');
  });

  it('shows only the first line of a multi-line command', () => {
    expect(toolTarget({ command: 'echo one\necho two' })).toBe('echo one');
  });

  it('falls back to compact JSON for tools with no obvious target', () => {
    expect(toolTarget({ some: 'thing' })).toBe('{"some":"thing"}');
  });
});

describe('renderToolResult', () => {
  it('keeps head and tail and elides the middle', () => {
    const content = Array.from({ length: 100 }, (_, i) => `row ${i}`).join('\n');
    const out = renderToolResult(content, false, plain, { head: 3, tail: 2 });
    expect(out).toContain('row 0');
    expect(out).toContain('row 2');
    expect(out).toContain('row 99');
    expect(out).toContain('95 lines elided');
    expect(out).not.toContain('row 50');
  });

  it('shows short output untouched', () => {
    const out = renderToolResult('one\ntwo', false, plain);
    expect(out).toContain('one');
    expect(out).toContain('two');
    expect(out).not.toContain('elided');
  });

  it('clips a single pathological line instead of flooding the terminal', () => {
    const out = renderToolResult('x'.repeat(5000), false, plain, { maxLineWidth: 100 });
    expect(out.length).toBeLessThan(300);
  });

  it('marks errors distinctly', () => {
    expect(renderToolResult('boom', true, plain)).toContain('✕');
    expect(renderToolResult('fine', false, plain)).toContain('✓');
  });

  it('does not print a bare tick for empty output', () => {
    expect(renderToolResult('   ', false, plain)).toContain('(no output)');
  });
});

describe('renderApprovalPreview', () => {
  it('diffs an Edit from its own arguments', () => {
    const out = renderApprovalPreview(
      'Edit',
      { file_path: 'a.ts', old_string: 'const a = 1', new_string: 'const a = 2' },
      plain,
    );
    expect(out).toContain('- const a = 1');
    expect(out).toContain('+ const a = 2');
  });

  it('diffs a Write against the file already on disk', () => {
    const out = renderApprovalPreview('Write', { content: 'new\nbody' }, plain, 'old\nbody');
    expect(out).toContain('- old');
    expect(out).toContain('+ new');
  });

  it('shows a Bash command in full, every line of it', () => {
    const out = renderApprovalPreview('Bash', { command: 'rm -rf build\nmake all' }, plain);
    expect(out).toContain('rm -rf build');
    expect(out).toContain('make all');
  });

  it('includes the description a Bash call carries', () => {
    const out = renderApprovalPreview('Bash', { command: 'ls', description: 'list files' }, plain);
    expect(out).toContain('list files');
  });

  it('falls back to the arguments for an unknown tool', () => {
    expect(renderApprovalPreview('Whatever', { a: 1 }, plain)).toContain('"a": 1');
  });
});

describe('ThinkingStream', () => {
  it('opens a labelled gutter and prefixes each line', () => {
    const s = new ThinkingStream(plain);
    const out = s.delta('first\nsecond');
    expect(out).toContain('┆ thinking');
    const body = out.split('\n').filter((l) => l.startsWith('  ┆ ') && !l.includes('thinking'));
    expect(body).toEqual(['  ┆ first', '  ┆ second']);
  });

  it('only labels the block once across deltas', () => {
    const s = new ThinkingStream(plain);
    const combined = s.delta('a') + s.delta('b');
    expect(combined.match(/┆ thinking/g)?.length).toBe(1);
  });

  it('closes cleanly and is idempotent', () => {
    const s = new ThinkingStream(plain);
    s.delta('mid-line');
    expect(s.isOpen).toBe(true);
    expect(s.close()).toBe('\n\n');
    expect(s.isOpen).toBe(false);
    expect(s.close()).toBe('');
  });

  it('closing before anything streamed emits nothing', () => {
    expect(new ThinkingStream(plain).close()).toBe('');
  });
});
