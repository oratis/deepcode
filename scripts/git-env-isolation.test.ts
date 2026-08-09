// A test that shells out to git must not inherit the outer repository.
//
// `git` reads GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE from the environment,
// and a git hook sets all three. The pre-commit gate runs the whole suite from
// inside `git commit`, so a fixture that calls `git init` on a temp directory
// without scrubbing the environment does not initialise the temp directory — it
// re-initialises the developer's own repository, as bare, and writes the test
// identity into its config. Every subsequent git command in that checkout then
// fails with "this operation must be run in a work tree".
//
// This is not hypothetical: apps/server/src/workspace-diff.test.ts did exactly
// that. Three separate fixtures had already grown their own copy of the scrub,
// two of them carrying a comment describing this precise failure — which is the
// tell that a convention passed by word of mouth had stopped being enforced.
//
// The rule is mechanical, so check it mechanically.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const roots = ['packages', 'apps', 'scripts'];
const skip = new Set(['node_modules', 'dist', 'target', '.git', 'out']);

function testFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) testFiles(path, found);
    else if (entry.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

// Matches `exec('git', [`, `spawnSync('git', [`, `runOrFail('git', [` — any
// helper whose first argument is the git binary and second is an argv array.
const spawnsGit = /\('git',\s*\[/;

describe('test fixtures that shell out to git', () => {
  it('scrub the inherited git environment', () => {
    const offenders = roots
      .flatMap((dir) => testFiles(join(root, dir)))
      .filter((path) => {
        const body = readFileSync(path, 'utf8');
        return spawnsGit.test(body) && !body.includes('gitSpawnEnv');
      })
      .map((path) => relative(root, path));

    expect(offenders).toEqual([]);
  });
});
