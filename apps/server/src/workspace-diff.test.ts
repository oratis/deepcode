import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { gitSpawnEnv } from '@deepcode/core';

import { collectWorkspaceDiff } from './workspace-diff.js';

const exec = promisify(execFile);

// `git init` inherits GIT_DIR. Run the suite from a git hook — which is exactly
// what the pre-commit gate does — and this fixture re-initialises the developer's
// own repository as bare and writes the test identity into its config. The code
// under test scrubs the environment; this fixture must too.
const GIT = { env: gitSpawnEnv() };

let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function repository(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'deepcode-workspace-diff-'));
  await exec('git', ['init', '-q'], { cwd: root, ...GIT });
  await exec('git', ['config', 'user.email', 'deepcode@example.invalid'], { cwd: root, ...GIT });
  await exec('git', ['config', 'user.name', 'DeepCode Test'], { cwd: root, ...GIT });
  await writeFile(join(root, 'modify me.txt'), 'one\ntwo\nthree\n');
  await writeFile(join(root, 'delete.ts'), 'delete me\n');
  await writeFile(join(root, 'rename-old.ts'), 'rename me\n');
  await exec('git', ['add', '.'], { cwd: root, ...GIT });
  await exec('git', ['commit', '-qm', 'initial'], { cwd: root, ...GIT });
  return root;
}

describe('collectWorkspaceDiff', () => {
  it('returns structured tracked and untracked hunks without shell parsing', async () => {
    const cwd = await repository();
    await writeFile(join(cwd, 'modify me.txt'), 'one\nchanged\nthree\n');
    await rm(join(cwd, 'delete.ts'));
    await mkdir(join(cwd, 'new dir'));
    await writeFile(join(cwd, 'new dir', 'new.ts'), 'export const value = 1;\n');
    await exec('git', ['mv', 'rename-old.ts', 'renamed.ts'], { cwd, ...GIT });

    const diff = await collectWorkspaceDiff(cwd);
    expect(diff).toMatchObject({ repository: true, base: 'HEAD', truncated: false });
    expect(diff.files.map((file) => [file.path, file.status])).toEqual([
      ['delete.ts', 'deleted'],
      ['modify me.txt', 'modified'],
      ['new dir/new.ts', 'added'],
      ['renamed.ts', 'renamed'],
    ]);
    expect(diff.files.find((file) => file.path === 'renamed.ts')?.previousPath).toBe(
      'rename-old.ts',
    );
    expect(diff.files.find((file) => file.path === 'modify me.txt')).toMatchObject({
      additions: 1,
      deletions: 1,
      binary: false,
      hunks: [
        expect.objectContaining({
          lines: expect.arrayContaining([
            { kind: 'deletion', oldLine: 2, text: 'two' },
            { kind: 'addition', newLine: 2, text: 'changed' },
          ]),
        }),
      ],
    });
  });

  it('does not read untracked symlinks or binary contents', async () => {
    const cwd = await repository();
    await writeFile(join(cwd, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    await import('node:fs/promises').then(({ symlink }) =>
      symlink('/etc/passwd', join(cwd, 'outside-link')),
    );

    const diff = await collectWorkspaceDiff(cwd);
    expect(diff.files.find((file) => file.path === 'binary.bin')).toMatchObject({ binary: true });
    expect(diff.files.find((file) => file.path === 'outside-link')).toMatchObject({
      binary: true,
      hunks: [],
    });
  });

  it('returns an empty non-repository result outside git', async () => {
    root = await mkdtemp(join(tmpdir(), 'deepcode-no-git-'));
    await expect(collectWorkspaceDiff(root)).resolves.toEqual({
      repository: false,
      base: null,
      files: [],
      truncated: false,
    });
  });
});
