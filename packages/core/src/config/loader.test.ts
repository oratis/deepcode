import { mkdtemp, rm } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deepMerge, loadSettings, settingsPaths, writeSettings } from './loader.js';

describe('settings loader', () => {
  let home: string;
  let cwd: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'dc-cwd-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('returns empty when no settings files exist', async () => {
    const s = await loadSettings({ cwd, home });
    expect(s.merged).toEqual({});
    expect(s.layers.user).toBeUndefined();
    expect(s.layers.project).toBeUndefined();
    expect(s.layers.local).toBeUndefined();
  });

  it('reads user-level only', async () => {
    const userPath = join(home, '.deepcode', 'settings.json');
    await writeSettings(userPath, { model: 'deepseek-chat', effortLevel: 'low' });
    const s = await loadSettings({ cwd, home });
    expect(s.merged.model).toBe('deepseek-chat');
    expect(s.merged.effortLevel).toBe('low');
  });

  it('project overrides user', async () => {
    await writeSettings(join(home, '.deepcode', 'settings.json'), {
      model: 'deepseek-chat',
      effortLevel: 'low',
    });
    await writeSettings(join(cwd, '.deepcode', 'settings.json'), {
      model: 'deepseek-reasoner',
    });
    const s = await loadSettings({ cwd, home });
    expect(s.merged.model).toBe('deepseek-reasoner');
    expect(s.merged.effortLevel).toBe('low'); // inherited from user
  });

  it('local overrides project + user', async () => {
    await writeSettings(join(home, '.deepcode', 'settings.json'), { model: 'deepseek-chat' });
    await writeSettings(join(cwd, '.deepcode', 'settings.json'), { model: 'deepseek-reasoner' });
    await writeSettings(join(cwd, '.deepcode', 'settings.local.json'), { model: 'override' });
    const s = await loadSettings({ cwd, home });
    expect(s.merged.model).toBe('override');
  });

  it('deepMerge merges nested objects, arrays replace', () => {
    const merged = deepMerge<Record<string, unknown>>(
      { a: { x: 1, y: 2 }, list: [1, 2] },
      { a: { y: 9, z: 3 }, list: [9] },
    );
    expect(merged.a).toEqual({ x: 1, y: 9, z: 3 });
    expect(merged.list).toEqual([9]); // replaced, not concatenated
  });

  it('settingsPaths uses .deepcode/ layout', () => {
    const p = settingsPaths({ cwd: '/proj', home: '/home/u' });
    expect(p.userPath).toBe('/home/u/.deepcode/settings.json');
    expect(p.projectPath).toBe('/proj/.deepcode/settings.json');
    expect(p.localPath).toBe('/proj/.deepcode/settings.local.json');
  });

  it('reports parse errors loudly', async () => {
    const path = join(home, '.deepcode', 'settings.json');
    await fs.mkdir(join(home, '.deepcode'), { recursive: true });
    await fs.writeFile(path, '{ not valid json');
    await expect(loadSettings({ cwd, home })).rejects.toThrow(/parse/i);
  });

  it('merges permissions objects (not arrays)', async () => {
    await writeSettings(join(home, '.deepcode', 'settings.json'), {
      permissions: { allow: ['Read'] },
    });
    await writeSettings(join(cwd, '.deepcode', 'settings.json'), {
      permissions: { deny: ['Read(/etc/*)'] },
    });
    const s = await loadSettings({ cwd, home });
    expect(s.merged.permissions?.allow).toEqual(['Read']);
    expect(s.merged.permissions?.deny).toEqual(['Read(/etc/*)']);
  });
});
