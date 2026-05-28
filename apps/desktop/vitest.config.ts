// Desktop renderer tests. Pure helpers run in node; component tests
// that need a DOM should `// @vitest-environment jsdom` at file top
// AND `pnpm add -D jsdom` first. (We don't pull jsdom into deps by
// default because the renderer doesn't need it at runtime.)

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    globals: true,
  },
});
