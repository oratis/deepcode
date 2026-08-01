import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(packageRoot, 'dist');
await mkdir(outputRoot, { recursive: true });

await Promise.all([
  build({
    entryPoints: [resolve(packageRoot, 'src', 'extension.ts')],
    outfile: resolve(outputRoot, 'extension.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['vscode'],
    define: {
      'import.meta.url': '__deepcode_import_meta_url',
    },
    banner: {
      js: 'const __deepcode_import_meta_url = require("node:url").pathToFileURL(__filename).href;',
    },
    sourcemap: true,
    legalComments: 'none',
  }),
  build({
    entryPoints: [resolve(packageRoot, '..', 'server', 'src', 'editor-entry.ts')],
    outfile: resolve(outputRoot, 'app-server.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
  }),
]);

const [extension, appServer] = await Promise.all([
  stat(resolve(outputRoot, 'extension.cjs')),
  stat(resolve(outputRoot, 'app-server.cjs')),
]);
process.stdout.write(
  `Built VS Code extension (${extension.size} bytes) + app-server (${appServer.size} bytes)\n`,
);
