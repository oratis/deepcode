import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeSourceHash,
  discoverPlugins,
  installLocal,
  loadTrustState,
  readManifest,
  saveTrustState,
} from './manifest.js';

async function fakePlugin(base: string, manifest: Record<string, unknown>): Promise<string> {
  const dir = join(base, 'src');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(base, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return base;
}

describe('plugin manifest', () => {
  let src: string;
  let home: string;

  beforeEach(async () => {
    src = await mkdtemp(join(tmpdir(), 'dc-plug-src-'));
    home = await mkdtemp(join(tmpdir(), 'dc-plug-home-'));
  });
  afterEach(async () => {
    await rm(src, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it('readManifest rejects missing name', async () => {
    await fakePlugin(src, { version: '0.0.1' });
    await expect(readManifest(src)).rejects.toThrow(/name/);
  });

  it('readManifest rejects missing version', async () => {
    await fakePlugin(src, { name: 'foo' });
    await expect(readManifest(src)).rejects.toThrow(/version/);
  });

  it('readManifest returns full manifest', async () => {
    await fakePlugin(src, {
      name: 'plug-a',
      version: '1.2.3',
      description: 'desc',
      contributes: { skills: ['./skills/foo'] },
    });
    const m = await readManifest(src);
    expect(m.name).toBe('plug-a');
    expect(m.version).toBe('1.2.3');
    expect(m.contributes?.skills).toEqual(['./skills/foo']);
  });

  it('computeSourceHash is deterministic', async () => {
    await fakePlugin(src, { name: 'h', version: '1' });
    const h1 = await computeSourceHash(src);
    const h2 = await computeSourceHash(src);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('computeSourceHash includes SKILL.md files', async () => {
    await fakePlugin(src, { name: 'h', version: '1' });
    const h1 = await computeSourceHash(src);
    const skillDir = join(src, 'skills', 's1');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(join(skillDir, 'SKILL.md'), 'content', 'utf8');
    const h2 = await computeSourceHash(src);
    expect(h1).not.toBe(h2);
  });

  it('trust state round-trip', async () => {
    await saveTrustState(home, {
      plugins: {
        foo: {
          version: '1',
          installedAt: 't',
          sourceHash: 'aaa',
          trustedBy: 'user',
        },
      },
    });
    const loaded = await loadTrustState(home);
    expect(loaded.plugins.foo?.sourceHash).toBe('aaa');
  });

  it('installLocal copies plugin + records trust', async () => {
    await fakePlugin(src, { name: 'inst', version: '0.1.0' });
    const result = await installLocal({ sourcePath: src, home });
    expect(result.manifest.name).toBe('inst');
    expect(result.sourceHash).toMatch(/^[0-9a-f]{16}$/);
    const trust = await loadTrustState(home);
    expect(trust.plugins.inst).toBeDefined();
    expect(trust.plugins.inst?.trustedBy).toBe('user');
    // Verify copy succeeded
    const copied = await fs.readFile(
      join(home, '.deepcode', 'plugins', 'inst', 'plugin.json'),
      'utf8',
    );
    expect(JSON.parse(copied).name).toBe('inst');
  });

  it('discoverPlugins returns [] when no plugins dir', async () => {
    const r = await discoverPlugins({ home });
    expect(r.plugins).toEqual([]);
    expect(r.hashMismatches).toEqual([]);
  });

  it('discoverPlugins finds installed plugin with valid hash', async () => {
    await fakePlugin(src, { name: 'disc', version: '0.1.0' });
    await installLocal({ sourcePath: src, home });
    const r = await discoverPlugins({ home });
    expect(r.plugins).toHaveLength(1);
    expect(r.plugins[0]?.manifest.name).toBe('disc');
    expect(r.hashMismatches).toEqual([]);
  });

  it('discoverPlugins flags hash mismatch', async () => {
    await fakePlugin(src, { name: 'drift', version: '0.1.0' });
    await installLocal({ sourcePath: src, home });
    // Mutate the installed plugin (simulate tampering)
    const installedManifest = join(home, '.deepcode', 'plugins', 'drift', 'plugin.json');
    await fs.writeFile(
      installedManifest,
      '{"name":"drift","version":"0.1.0","extra":"oops"}',
      'utf8',
    );
    const r = await discoverPlugins({ home });
    expect(r.plugins).toHaveLength(0);
    expect(r.hashMismatches[0]).toMatch(/hash drift/);
  });

  it('discoverPlugins respects disabled list', async () => {
    await fakePlugin(src, { name: 'maybe', version: '0.1.0' });
    await installLocal({ sourcePath: src, home });
    const r = await discoverPlugins({ home, disabled: ['maybe'] });
    expect(r.plugins[0]?.enabled).toBe(false);
  });

  it('discoverPlugins skips untrusted plugins (in dir but not in manifest)', async () => {
    // Simulate someone manually copying a plugin directory without going through installLocal
    const dir = join(home, '.deepcode', 'plugins', 'unknown');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, 'plugin.json'),
      JSON.stringify({ name: 'unknown', version: '0.0.1' }),
      'utf8',
    );
    const r = await discoverPlugins({ home });
    expect(r.plugins).toHaveLength(0);
    expect(r.hashMismatches[0]).toMatch(/not in trust manifest/);
  });
});
