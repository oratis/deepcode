import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPluginsCommand, runSkillsCommand } from './list-cmd.js';

function sink(): { stream: Writable; text: () => string } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => buf };
}

describe('runPluginsCommand', () => {
  let home: string;
  let cwd: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-listp-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'dc-listp-cwd-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('reports no plugins for an empty home', async () => {
    const out = sink();
    const code = await runPluginsCommand(['list'], { cwd, home, output: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toMatch(/No plugins installed/);
  });

  it('flags an installed-but-untrusted plugin under "Not loaded"', async () => {
    // A plugin on disk that was never trusted is not loaded (security), but the
    // listing surfaces it so the user knows it's there.
    const dir = join(home, '.deepcode', 'plugins', 'demo');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, 'plugin.json'),
      JSON.stringify({ name: 'demo', version: '1.2.3', description: 'A demo plugin' }),
    );
    const out = sink();
    await runPluginsCommand(['list'], { cwd, home, output: out.stream });
    expect(out.text()).toMatch(/Not loaded/);
    expect(out.text()).toMatch(/demo.*trust manifest/);
  });

  it('--json emits a parseable {plugins,issues} object', async () => {
    const out = sink();
    await runPluginsCommand(['list'], { cwd, home, output: out.stream, json: true });
    expect(JSON.parse(out.text())).toEqual({ plugins: [], issues: [] });
  });

  it('rejects an unknown subcommand with exit 2', async () => {
    const out = sink();
    const code = await runPluginsCommand(['frob'], { cwd, home, output: out.stream });
    expect(code).toBe(2);
    expect(out.text()).toMatch(/Usage: deepcode plugins/);
  });

  it('installs a local plugin and then lists it as trusted', async () => {
    // A local plugin source dir.
    const src = join(cwd, 'my-plugin');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(
      join(src, 'plugin.json'),
      JSON.stringify({ name: 'localdemo', version: '0.1.0', description: 'local one' }),
    );
    const out = sink();
    const code = await runPluginsCommand(['install', src], { cwd, home, output: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toMatch(/Installed localdemo@0\.1\.0/);

    // Now it's installed + trusted → appears in the loaded list (not "Not loaded").
    const list = sink();
    await runPluginsCommand(['list'], { cwd, home, output: list.stream, json: true });
    const parsed = JSON.parse(list.text()) as { plugins: Array<{ name: string }> };
    expect(parsed.plugins.some((p) => p.name === 'localdemo')).toBe(true);
  });

  it('uninstalls an installed plugin', async () => {
    const src = join(cwd, 'p2');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(join(src, 'plugin.json'), JSON.stringify({ name: 'p2', version: '1.0.0' }));
    await runPluginsCommand(['install', src], { cwd, home, output: sink().stream });

    const out = sink();
    const code = await runPluginsCommand(['uninstall', 'p2'], { cwd, home, output: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toMatch(/Uninstalled p2/);

    const missing = sink();
    const code2 = await runPluginsCommand(['uninstall', 'p2'], {
      cwd,
      home,
      output: missing.stream,
    });
    expect(code2).toBe(1);
    expect(missing.text()).toMatch(/No plugin named/);
  });

  it('install with no spec → usage exit 2; bad gh spec → error exit 1', async () => {
    const noSpec = sink();
    expect(await runPluginsCommand(['install'], { cwd, home, errOutput: noSpec.stream })).toBe(2);
    expect(noSpec.text()).toMatch(/Usage: deepcode plugins install/);

    const badGh = sink();
    const code = await runPluginsCommand(['install', 'gh:not-a-valid-spec!!'], {
      cwd,
      home,
      errOutput: badGh.stream,
    });
    expect(code).toBe(1);
    expect(badGh.text()).toMatch(/Install failed.*Invalid GitHub spec/);
  });
});

describe('runSkillsCommand', () => {
  let home: string;
  let cwd: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-lists-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'dc-lists-cwd-'));
    // A project-level skill.
    const skillDir = join(cwd, '.deepcode', 'skills', 'greet');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: greet\ndescription: Say hello nicely\n---\nGreet the user.\n',
    );
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('lists a project skill with its source tag', async () => {
    const out = sink();
    const code = await runSkillsCommand(['list'], { cwd, home, output: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toContain('greet');
    expect(out.text()).toContain('[project]');
    expect(out.text()).toContain('Say hello nicely');
  });

  it('--json includes the project skill', async () => {
    const out = sink();
    await runSkillsCommand(['list'], { cwd, home, output: out.stream, json: true });
    const rows = JSON.parse(out.text()) as Array<{ name: string; source: string }>;
    expect(rows.some((r) => r.name === 'greet' && r.source === 'project')).toBe(true);
  });

  it('rejects an unknown subcommand with exit 2', async () => {
    const out = sink();
    const code = await runSkillsCommand(['frob'], { cwd, home, output: out.stream });
    expect(code).toBe(2);
    expect(out.text()).toMatch(/Usage: deepcode skills list/);
  });
});
