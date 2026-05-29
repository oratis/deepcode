// CLI unit tests run in node. They import from @deepcode/core, whose
// package "main" points at ./dist — so without this alias the tests would
// require `@deepcode/core` to be built first (a build-order footgun that
// only works in CI because `pnpm typecheck` runs `tsc -b` and emits dist
// before `pnpm test`). Aliasing the bare specifier to core's source makes
// the tests self-contained and fast, mirroring apps/desktop/vite.config.ts.

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@deepcode/core': resolve(__dirname, '..', '..', 'packages', 'core', 'src', 'index.ts'),
    },
  },
});
