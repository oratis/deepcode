// Vitest config — keeps tests fast by default, but pins a sequential
// run for tests that touch global resources (git worktrees, fs locks).

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sequential by default for files that fight over the same git registry.
    sequence: {
      hooks: 'parallel',
    },
    poolOptions: {
      forks: {
        // Run each test file in its own fork so worktree / git operations
        // don't interfere across files.
        isolate: true,
      },
    },
  },
});
