// Vite config for the DeepCode desktop renderer.
// Spec: docs/DEVELOPMENT_PLAN.md §4
// Milestone: M6-rest
//
// Renderer is a single-page React app served from dist/. In dev,
// `pnpm dev` starts the vite dev server on 5173; the Electron main
// process points BrowserWindow at http://localhost:5173. In prod,
// electron-builder packages dist/ alongside dist-electron/.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src'),
  base: './',
  publicDir: resolve(__dirname, 'public'),
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: resolve(__dirname, 'src', 'index.html'),
    },
  },
  resolve: {
    alias: {
      '@deepcode/core': resolve(__dirname, '..', '..', 'packages', 'core', 'src', 'index.ts'),
    },
  },
});
