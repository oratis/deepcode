// Environment for spawning `git` against an explicit directory.
//
// why: git resolves the repository from GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE
// (and friends) in the environment BEFORE falling back to the directory it is
// invoked in. When DeepCode — or, more commonly, its test suite — runs inside a
// `git` hook (a contributor's pre-commit hook executing `pnpm test`), git
// exports these vars and Node child processes inherit them. Any `git -C <dir> …`
// we then run is silently redirected at the hook's repo instead of <dir>,
// producing "fatal: this operation must be run in a work tree" and — for
// `git init` in a test's temp repo — re-initializing the REAL repo as bare
// (core.bare=true), which breaks every subsequent worktree operation.
//
// Stripping every GIT_* var forces git to rediscover the repository from the
// cwd we actually pass. (worktree/index.ts pioneered this; this is the shared
// helper the rest of the codebase and its tests reuse.)

/**
 * Return a copy of `base` (default `process.env`) with every `GIT_*` variable
 * removed, suitable for spawning `git` against an explicit `cwd`.
 */
export function gitSpawnEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}
