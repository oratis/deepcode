import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(packageRoot, 'dist-sidecar', 'app-server.cjs');
const settingsSchema = await readFile(
  resolve(packageRoot, '..', '..', 'packages', 'core', 'schemas', 'settings.schema.json'),
  'utf8',
);
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
  define: {
    __DEEPCODE_SETTINGS_SCHEMA__: JSON.stringify(settingsSchema),
    'import.meta.url': 'undefined',
  },
  banner: { js: '#!/usr/bin/env node' },
});

const bytes = (await stat(output)).size;
process.stdout.write(`Built ${output} (${bytes} bytes)\n`);
