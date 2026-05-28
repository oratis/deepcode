// Desktop has no renderer tests yet (lands once Electron + Vite deps are
// installed). Explicitly disable vite + css processing so vitest doesn't
// try to load vite.config.ts / postcss.config.js with deps absent.

export default {
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
  // Disable vite config discovery entirely
  configFile: false,
} as const;
