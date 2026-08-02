import { copyFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target =
  process.env.DEEPCODE_TARGET ?? process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTargetTriple();
const source = process.env.DEEPCODE_NODE_RUNTIME ?? process.execPath;

if (process.env.CI && !process.env.DEEPCODE_NODE_RUNTIME) {
  throw new Error('CI desktop packaging requires a pinned DEEPCODE_NODE_RUNTIME');
}

const destination = resolve(
  desktopRoot,
  'src-tauri',
  'binaries',
  `deepcode-runtime-${target}${target.includes('windows') ? '.exe' : ''}`,
);
await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);

let thinned = false;
if (process.platform === 'darwin' && target.endsWith('apple-darwin')) {
  const architectures = spawnSync('/usr/bin/lipo', ['-archs', destination]);
  if (architectures.status !== 0) {
    throw new Error(`unable to inspect Node runtime architecture: ${architectures.stderr.toString()}`);
  }
  const availableArchitectures = architectures.stdout.toString().trim().split(/\s+/);
  if (target.startsWith('universal')) {
    if (!availableArchitectures.includes('arm64') || !availableArchitectures.includes('x86_64')) {
      throw new Error('universal desktop target requires a universal Node runtime');
    }
  } else {
    const architecture = target.startsWith('aarch64') ? 'arm64' : 'x86_64';
    if (!availableArchitectures.includes(architecture)) {
      throw new Error(
        `desktop target ${target} requires ${architecture}, but Node runtime contains ${availableArchitectures.join(', ')}`,
      );
    }
    const thinPath = `${destination}.thin`;
    const thin = spawnSync('/usr/bin/lipo', [
      destination,
      '-thin',
      architecture,
      '-output',
      thinPath,
    ]);
    if (thin.status === 0) {
      await rename(thinPath, destination);
      thinned = true;
    }
  }
  const strip = spawnSync('/usr/bin/strip', ['-S', destination]);
  if (strip.status !== 0) throw new Error(`strip failed: ${strip.stderr.toString()}`);
  const sign = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', destination]);
  if (sign.status !== 0) throw new Error(`ad-hoc signing failed: ${sign.stderr.toString()}`);
}

process.stdout.write(
  `${JSON.stringify({ target, source, destination, bytes: (await stat(destination)).size, thinned })}\n`,
);

function hostTargetTriple() {
  if (process.platform === 'darwin') {
    return `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
  }
  if (process.platform === 'linux') {
    return `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`;
  }
  if (process.platform === 'win32') {
    return `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`;
  }
  throw new Error(`Unsupported desktop sidecar host: ${process.platform}-${process.arch}`);
}
