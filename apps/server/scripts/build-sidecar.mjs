import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(packageRoot, 'dist-sidecar', 'app-server.cjs');
await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [resolve(packageRoot, 'src', 'sidecar-entry.ts')],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
});

const bytes = (await stat(output)).size;
process.stdout.write(`Built ${output} (${bytes} bytes)\n`);
