// LSP unit tests run in node and reach @deepcode/core through handler.ts.
// core's package "main" points at ./dist, so without this alias the tests
// would require core to be built first (a build-order footgun that only
// works in CI because `pnpm typecheck` runs `tsc -b` and emits dist before
// `pnpm test`). Aliasing the bare specifier to core's source keeps the
// tests self-contained, mirroring apps/cli + apps/desktop.

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
