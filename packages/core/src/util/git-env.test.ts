import { describe, expect, it } from 'vitest';
import { gitSpawnEnv } from './git-env.js';

describe('gitSpawnEnv', () => {
  it('strips every GIT_* variable', () => {
    const env = gitSpawnEnv({
      GIT_DIR: '/somewhere/.git',
      GIT_WORK_TREE: '/somewhere',
      GIT_INDEX_FILE: '/somewhere/.git/index',
      GIT_OBJECT_DIRECTORY: '/somewhere/.git/objects',
      GIT_AUTHOR_NAME: 'x',
      PATH: '/usr/bin',
    });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_INDEX_FILE).toBeUndefined();
    expect(env.GIT_OBJECT_DIRECTORY).toBeUndefined();
    expect(env.GIT_AUTHOR_NAME).toBeUndefined();
  });

  it('preserves non-GIT variables', () => {
    const env = gitSpawnEnv({ PATH: '/usr/bin', HOME: '/home/u', GIT_DIR: '/x' });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
  });

  it('does not mutate the input env', () => {
    const base = { GIT_DIR: '/x', PATH: '/usr/bin' };
    gitSpawnEnv(base);
    expect(base.GIT_DIR).toBe('/x');
  });

  it('output never contains a GIT_* key (defaults to process.env)', () => {
    const env = gitSpawnEnv();
    expect(Object.keys(env).some((k) => k.startsWith('GIT_'))).toBe(false);
  });
});
