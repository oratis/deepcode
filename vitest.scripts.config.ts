// Root vitest config — picks up scripts/*.test.ts (build tooling tests).
// Per-package configs in packages/*/vitest.config.ts handle package tests.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'packages/**', 'apps/**'],
  },
});
