// Vite config for the DeepCode Tauri renderer.
// Spec: docs/DEVELOPMENT_PLAN.md §4
//
// Tauri builds `src/` into `dist/`. Dev server runs on 5173; Tauri
// `beforeDevCommand` boots us, then loads http://localhost:5173 in the
// webview. In prod, src-tauri/tauri.conf.json points at ../dist.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src'),
  base: './',
  publicDir: resolve(__dirname, 'public'),
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host ?? false,
    hmr: host
      ? { protocol: 'ws', host, port: 5174 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    minify: 'esbuild',
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
