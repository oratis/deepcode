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
    expect(out.text()).toMatch(/Usage: deepcode plugins list/);
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
