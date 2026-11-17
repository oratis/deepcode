import { realpath, mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SandboxConfig } from '../../config/types.js';
import { resolveSandboxMode } from '../../sandbox/policy.js';

/** Plugin code gets its installation + private scratch, never the host workspace. */
export async function pluginSpawnPlan(plugin: string, scratch: string, sandbox?: SandboxConfig) {
  const node = await realpath(process.execPath);
  const directory = await realpath(plugin);
  const privateRoot = await realpath(scratch);
  const home = join(privateRoot, 'home');
  const temp = join(privateRoot, 'tmp');
  await mkdir(home);
  await mkdir(temp);
  const env: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin',
    HOME: home,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    LANG: 'en_US.UTF-8',
  };
  if (resolveSandboxMode(sandbox) === 'danger-full-access')
    return { command: node, args: [] as string[], env, cwd: directory };
  if (process.platform === 'darwin') {
    const quote = (path: string) => JSON.stringify(path);
    const ancestors = new Set<string>();
    for (const start of [directory, node, home, temp, '/System/Library', '/usr/lib']) {
      for (let path = dirname(start); ; path = dirname(path)) {
        ancestors.add(path);
        if (path === dirname(path)) break;
      }
    }
    const profile = [
      '(version 1)',
      '(deny default)',
      '(allow process-exec)',
      // No process-fork, network, or Mach lookup: subprocess effects use the broker.
      '(allow sysctl-read)',
      '(allow file-read-metadata)',
      ...[...ancestors].map((path) => `(allow file-read* (literal ${quote(path)}))`),
      ...['/System/Library', '/usr/lib', directory, dirname(node)].map(
        (path) => `(allow file-read* (subpath ${quote(path)}))`,
      ),
      '(allow file-read* (literal "/dev/urandom") (literal "/dev/random"))',
      '(allow file-read* file-write* (literal "/dev/null"))',
      `(allow file-read* file-write* (subpath ${quote(home)}) (subpath ${quote(temp)}))`,
    ].join('\n');
    const path = join(privateRoot, 'sandbox.sb');
    await writeFile(path, profile, { mode: 0o600 });
    return { command: '/usr/bin/sandbox-exec', args: ['-f', path, node], env, cwd: directory };
  }
  if (process.platform === 'linux') {
    // A private mount/net/pid namespace; no host root or home bind.
    const args = [
      '--unshare-all',
      '--die-with-parent',
      '--new-session',
      '--tmpfs',
      '/',
      '--proc',
      '/proc',
      '--dev',
      '/dev',
    ];
    for (const path of ['/usr', '/bin', '/lib', '/lib64']) {
      try {
        await access(path);
        args.push('--ro-bind', path, path);
      } catch {
        /* absent distro path */
      }
    }
    for (const path of [directory, dirname(node)]) args.push('--ro-bind', path, path);
    // Bind targets need writable parents during setup. Seal that synthetic root
    // afterwards; --remount-ro is non-recursive, so private HOME/TMP stay writable.
    args.push(
      '--bind',
      home,
      home,
      '--bind',
      temp,
      temp,
      '--remount-ro',
      '/',
      '--chdir',
      directory,
      '--',
      node,
    );
    return { command: 'bwrap', args, env, cwd: directory };
  }
  throw new Error(
    `Plugin isolation is unavailable on ${process.platform}; no unsandboxed fallback`,
  );
}
