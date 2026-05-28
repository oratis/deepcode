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
    alias: [
      // Subpath imports — load directly from compiled dist/. The renderer
      // can't bundle some core modules (node:fs deps), so we cherry-pick
      // (only agent.js / providers/deepseek.js / types.js are referenced
      // from the renderer code).
      {
        find: /^@deepcode\/core\/dist\/(.+)$/,
        replacement: resolve(__dirname, '..', '..', 'packages', 'core', 'dist') + '/$1',
      },
      // Bare import — anything that resolves through the index. We avoid
      // doing this in the renderer (use mac-tools/mac-agent which import
      // from subpaths) but keep the alias so types still resolve.
      {
        find: '@deepcode/core',
        replacement: resolve(__dirname, '..', '..', 'packages', 'core', 'src', 'index.ts'),
      },
    ],
  },
});
