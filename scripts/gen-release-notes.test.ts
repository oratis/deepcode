import { describe, expect, it } from 'vitest';
import {
  absoluteLinks,
  bucketCommits,
  changelogEntry,
  classify,
  parseArgs,
  renderMarkdown,
  strip,
} from './gen-release-notes.js';

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

const CHANGELOG = `# Changelog

Preamble that belongs to no release.

## [Unreleased]

- something not shipped yet

## [0.3.1] — 2026-08-09

Summary line.

### Fixed

- Fixed a thing, see [the docs](docs/file-contract.md) and
  [an anchor](docs/x.md#section) and [./relative](./scripts/a.mjs).
- Left alone: [external](https://example.com) and [in-page](#fixed).

## [0.3.0] — 2026-08-08

Older release.
`;

describe('changelogEntry', () => {
  it('returns one version section, heading excluded', () => {
    const entry = changelogEntry(CHANGELOG, '0.3.1');
    expect(entry).toContain('Summary line.');
    expect(entry).toContain('### Fixed');
    // The release page already shows the version as its title.
    expect(entry).not.toContain('## [0.3.1]');
    // And stops at the next release rather than swallowing it.
    expect(entry).not.toContain('Older release');
    expect(entry).not.toContain('not shipped yet');
  });

  it('is undefined for a version with no entry', () => {
    expect(changelogEntry(CHANGELOG, '9.9.9')).toBeUndefined();
  });

  it('cannot be satisfied by the Unreleased section', () => {
    // A release that shipped whatever happened to be sitting under "Unreleased"
    // would be lying about its own contents.
    expect(changelogEntry(CHANGELOG, 'Unreleased')).toContain('not shipped yet');
    expect(changelogEntry(CHANGELOG, '0.4.0')).toBeUndefined();
  });

  it('does not match a version mentioned inside prose', () => {
    const md = 'Text about ## [0.3.1] inline.\n\n## [0.2.0]\n\nreal\n';
    expect(changelogEntry(md, '0.3.1')).toBeUndefined();
  });

  it('treats an empty section as absent, so the commit log takes over', () => {
    expect(changelogEntry('## [1.0.0]\n\n## [0.9.0]\n\nbody\n', '1.0.0')).toBeUndefined();
  });
});

describe('absoluteLinks', () => {
  const out = absoluteLinks(changelogEntry(CHANGELOG, '0.3.1')!, 'oratis/deepcode', 'v0.3.1');

  it('pins repo-relative links at the tag', () => {
    // Release bodies do not render inside the repository, so a relative link
    // resolves against nothing. The tag rather than main, so the link keeps
    // pointing at this release's version of the file after it moves.
    expect(out).toContain(
      '](https://github.com/oratis/deepcode/blob/v0.3.1/docs/file-contract.md)',
    );
  });

  it('keeps anchors and strips a leading ./', () => {
    expect(out).toContain('/blob/v0.3.1/docs/x.md#section)');
    expect(out).toContain('/blob/v0.3.1/scripts/a.mjs)');
  });

  it('leaves absolute and in-page links alone', () => {
    expect(out).toContain('](https://example.com)');
    expect(out).toContain('](#fixed)');
  });
});

describe('parseArgs', () => {
  it('keeps the two positional refs working', () => {
    expect(parseArgs(['v0.3.0', 'HEAD'])).toMatchObject({ from: 'v0.3.0', to: 'HEAD' });
  });

  it('reads flags in any position', () => {
    expect(parseArgs(['--version', '1.2.3', 'a', 'b', '--repo', 'o/n'])).toMatchObject({
      from: 'a',
      to: 'b',
      version: '1.2.3',
      repo: 'o/n',
    });
  });

  it('defaults the changelog path', () => {
    expect(parseArgs([]).changelog).toBe('CHANGELOG.md');
  });
});
