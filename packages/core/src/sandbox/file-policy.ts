import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { SandboxConfig, SandboxMode } from '../config/types.js';
import { resolveSandboxMode } from './policy.js';

async function resolvedTarget(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await resolvedTarget(parent), relative(parent, path));
  }
}
function contains(root: string, path: string) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../'));
}
export async function fileWriteDenial(
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
  config?: SandboxConfig,
  fallback?: SandboxMode,
): Promise<string | undefined> {
  if (!['Write', 'Edit', 'NotebookEdit'].includes(tool)) return;
  const mode = resolveSandboxMode(config, fallback);
  if (mode === 'danger-full-access') return;
  if (mode === 'read-only') return 'The sandbox is read-only';
  const path = tool === 'NotebookEdit' ? input.notebook_path : input.file_path;
  if (typeof path !== 'string' || !path) return 'A file path is required';
  try {
    const target = await resolvedTarget(resolve(cwd, path));
    try {
      if ((await stat(target)).nlink > 1) return 'Refusing to write a hard-linked file';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const root of config?.filesystem?.denyWrite ?? []) {
      if (contains(await resolvedTarget(resolve(cwd, root)), target))
        return 'File write is excluded by sandbox.filesystem.denyWrite';
    }
    for (const root of [cwd, ...(config?.filesystem?.allowWrite ?? [])]) {
      const resolvedRoot = await resolvedTarget(resolve(cwd, root));
      if (contains(resolvedRoot, target)) return;
    }
    return 'File write escapes the writable workspace (including symlinks)';
  } catch {
    return 'Cannot verify the file write boundary';
  }
}
