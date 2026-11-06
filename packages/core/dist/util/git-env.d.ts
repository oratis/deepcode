/**
 * Return a copy of `base` (default `process.env`) with every `GIT_*` variable
 * removed, suitable for spawning `git` against an explicit `cwd`.
 */
export declare function gitSpawnEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
//# sourceMappingURL=git-env.d.ts.map