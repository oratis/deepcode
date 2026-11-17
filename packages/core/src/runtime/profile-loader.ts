import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveProfile, type ProfileLayer, type RuntimeProfileId } from './profile.js';
/** Only trusted workspace layers are read; profiles cannot import code or select endpoints. */
export async function loadProfileLayers(options: {
  profileId: RuntimeProfileId;
  cwd: string;
  home?: string;
  directory?: string;
  workspaceTrusted?: boolean;
}): Promise<ProfileLayer[]> {
  const layers: ProfileLayer[] = [];
  const read = async (path: string, source: ProfileLayer['source']) => {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    layers.push({ source, value: JSON.parse(raw) });
  };
  // Validate the name before it can participate in a filesystem path.
  resolveProfile(options.profileId);
  const directory = options.directory ?? join(options.home ?? homedir(), '.deepcode');
  await read(join(directory, 'profiles', `${options.profileId}.json`), 'user-profile');
  await read(join(directory, 'runtime-profile.json'), 'user-global');
  if (options.workspaceTrusted)
    await read(join(options.cwd, '.deepcode', 'runtime-profile.json'), 'trusted-workspace');
  resolveProfile(options.profileId, layers);
  return layers;
}
