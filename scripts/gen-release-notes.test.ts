import { describe, expect, it } from 'vitest';
import { bucketCommits, classify, renderMarkdown, strip } from './gen-release-notes.js';

describe('classify', () => {
  it.each([
    ['feat: add X', 'feat'],
    ['fix(core): bug', 'fix'],
    ['fix(core)!: breaking', 'fix'],
    ['feat!: breaking new', 'feat'],
    ['perf: faster loops', 'perf'],
    ['refactor: extract', 'refactor'],
    ['docs: readme', 'docs'],
    ['test: more coverage', 'test'],
    ['chore: bump deps', 'chore'],
    ['Bump foo', 'other'],
    ['random subject', 'other'],
  ])('"%s" → %s', (subject, expected) => {
    expect(classify({ hash: 'h', subject, body: '' })).toBe(expected);
  });
});

describe('strip', () => {
  it('drops type(scope) prefix', () => {
    expect(strip('feat(core): add tool search')).toBe('add tool search');
    expect(strip('fix!: emergency')).toBe('emergency');
  });
  it('drops Co-Authored-By trailers', () => {
    expect(strip('feat: x\nbody\nCo-Authored-By: Claude <x@y>')).toContain('body');
    expect(strip('feat: x\nbody\nCo-Authored-By: Claude <x@y>')).not.toContain('Co-Authored');
  });
});

describe('bucketCommits + renderMarkdown', () => {
  const commits = [
    { hash: 'aaa1111', subject: 'feat: ship A', body: '' },
    { hash: 'bbb2222', subject: 'fix(core): B', body: '' },
    { hash: 'ccc3333', subject: 'chore(ci): C', body: '' },
    { hash: 'ddd4444', subject: 'random commit', body: '' },
  ];

  it('groups commits by type', () => {
    const b = bucketCommits(commits);
    expect(b.feat!.commits).toHaveLength(1);
    expect(b.fix!.commits).toHaveLength(1);
    expect(b.chore!.commits).toHaveLength(1);
    expect(b.other!.commits).toHaveLength(1);
  });

  it('renders markdown with stripped subjects + short hashes', () => {
    const md = renderMarkdown('v0', 'v1', bucketCommits(commits));
    expect(md).toContain('# Release notes (v0…v1)');
    expect(md).toContain('## ✨ New');
    expect(md).toContain('- ship A (aaa1111)');
    expect(md).toContain('## 🐛 Fixes');
    expect(md).toContain('- B (bbb2222)');
    expect(md).toContain('4 commits');
  });

  it('omits empty buckets', () => {
    const onlyFeat = [{ hash: 'h1', subject: 'feat: x', body: '' }];
    const md = renderMarkdown('a', 'b', bucketCommits(onlyFeat));
    expect(md).toContain('## ✨ New');
    expect(md).not.toContain('## 🐛 Fixes');
    expect(md).not.toContain('## 🔧 Chore');
  });
});
