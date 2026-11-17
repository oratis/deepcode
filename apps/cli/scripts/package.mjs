import { execFileSync } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(cliRoot, '../..');
const output = join(cliRoot, 'dist/npm');
const staging = join(output, 'package');
const source = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'));
const server = JSON.parse(await readFile(join(root, 'apps/server/package.json'), 'utf8'));
await rm(output, { recursive: true, force: true });
await mkdir(join(staging, 'dist'), { recursive: true });

// Keep the workspace's tsc output untouched. Only this self-contained staging
// package may be published: the private @deepcode workspaces are bundled here.
const result = await build({
  absWorkingDir: root,
  entryPoints: [join(cliRoot, 'src/cli.ts')],
  outfile: join(staging, 'dist/cli.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  metafile: true,
  legalComments: 'eof',
  external: ['@anthropic-ai/claude-agent-sdk'],
  define: {
    __DEEPCODE_BUNDLED_CLI__: 'true',
    __DEEPCODE_SETTINGS_SCHEMA__: JSON.stringify(
      await readFile(join(root, 'packages/core/schemas/settings.schema.json'), 'utf8'),
    ),
  },
  // Bundled CommonJS dependencies still need Node's require in this ESM entry.
  banner: {
    js: 'import { createRequire as __deepcodeCreateRequire } from "node:module";\nconst require = __deepcodeCreateRequire(import.meta.url);',
  },
});
await chmod(join(staging, 'dist/cli.js'), 0o755);
await cp(join(root, 'packages/core/skills'), join(staging, 'skills'), { recursive: true });
await cp(join(root, 'packages/core/schemas'), join(staging, 'schemas'), { recursive: true });
await Promise.all([
  copyFile(join(cliRoot, 'README.md'), join(staging, 'README.md')),
  copyFile(join(root, 'LICENSE'), join(staging, 'LICENSE')),
  copyFile(join(root, 'CHANGELOG.md'), join(staging, 'CHANGELOG.md')),
]);

const manifest = {
  name: source.name,
  version: source.version,
  description: source.description,
  license: source.license,
  type: 'module',
  bin: { deepcode: './dist/cli.js' },
  main: './dist/cli.js',
  files: [
    'dist/',
    'skills/',
    'schemas/',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'THIRD_PARTY_NOTICES.md',
  ],
  engines: source.engines,
  repository: { type: 'git', url: 'https://github.com/oratis/deepcode.git' },
  optionalDependencies: server.optionalDependencies,
};
await writeFile(join(staging, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(staging, 'THIRD_PARTY_NOTICES.md'), await bundledNotices(result.metafile));
const packed = JSON.parse(
  execFileSync(
    'npm',
    [
      'pack',
      '--offline',
      '--ignore-scripts',
      '--json',
      '--userconfig',
      '/dev/null',
      '--cache',
      join(output, 'cache'),
      '--pack-destination',
      output,
    ],
    {
      cwd: staging,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ),
)[0];
await writeFile(
  join(output, 'package-report.json'),
  JSON.stringify(
    {
      version: source.version,
      tarball: join(output, packed.filename),
      integrity: packed.integrity,
      size: packed.size,
      unpackedSize: packed.unpackedSize,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write(`Packed ${packed.filename} (${packed.size} bytes)\n`);

async function bundledNotices(metafile) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    if (!input.includes('node_modules/')) continue;
    let directory = dirname(resolve(root, input));
    while (directory !== dirname(directory)) {
      try {
        const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (pkg.name && pkg.version) {
          packages.set(`${pkg.name}@${pkg.version}`, { directory, pkg });
          break;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      directory = dirname(directory);
    }
  }
  const notices = ['# Bundled third-party notices\n'];
  for (const [name, { directory, pkg }] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const files = (await readdir(directory)).filter((file) =>
      /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(file),
    );
    if (!files.length) throw new Error(`No license notice found for bundled dependency ${name}`);
    notices.push(`## ${name}\n\nLicense: ${pkg.license ?? 'see notice below'}\n`);
    for (const file of files.sort())
      notices.push(`### ${file}\n\n${await readFile(join(directory, file), 'utf8')}\n`);
  }
  return notices.join('\n');
}
