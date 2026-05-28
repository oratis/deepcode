// Desktop renderer tests — kept minimal until UI integration tests land.
// Tauri deps now installed; vite config is real.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
  },
});
