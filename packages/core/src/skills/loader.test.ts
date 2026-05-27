import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSkillsDescriptionBlock, loadSkills } from './loader.js';

async function writeSkill(
  base: string,
  name: string,
  front: Record<string, unknown>,
  body = 'body',
): Promise<void> {
  const dir = join(base, name);
  await fs.mkdir(dir, { recursive: true });
  const fm = ['---'];
  for (const [k, v] of Object.entries(front)) {
    if (Array.isArray(v)) fm.push(`${k}: [${v.map((x) => `"${x}"`).join(', ')}]`);
    else if (typeof v === 'boolean') fm.push(`${k}: ${v}`);
    else fm.push(`${k}: "${v}"`);
  }
  fm.push('---', '', body);
  await fs.writeFile(join(dir, 'SKILL.md'), fm.join('\n'), 'utf8');
}

describe('loadSkills', () => {
  let home: string;
  let cwd: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-skills-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'dc-skills-cwd-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('returns [] when no skills exist', async () => {
    expect(await loadSkills({ cwd, home })).toEqual([]);
  });

  it('loads user-level skills', async () => {
    await writeSkill(join(home, '.deepcode', 'skills'), 'verify', {
      name: 'verify',
      description: 'Run the app and confirm.',
    });
    const skills = await loadSkills({ cwd, home });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.qualifiedName).toBe('verify');
    expect(skills[0]?.source).toBe('user');
  });

  it('loads project-level skills', async () => {
    await writeSkill(join(cwd, '.deepcode', 'skills'), 'project-x', {
      name: 'project-x',
      description: 'Project-specific skill.',
    });
    const skills = await loadSkills({ cwd, home });
    expect(skills[0]?.source).toBe('project');
  });

  it('parses tools array + effort + model', async () => {
    await writeSkill(join(cwd, '.deepcode', 'skills'), 'review', {
      name: 'review',
      description: 'Code review.',
      'allowed-tools': ['Read', 'Bash', 'Grep'],
      model: 'deepseek-reasoner',
      effort: 'high',
    });
    const skills = await loadSkills({ cwd, home });
    expect(skills[0]?.frontmatter['allowed-tools']).toEqual(['Read', 'Bash', 'Grep']);
    expect(skills[0]?.frontmatter.model).toBe('deepseek-reasoner');
    expect(skills[0]?.frontmatter.effort).toBe('high');
  });

  it('skips malformed skills (missing name or description)', async () => {
    const dir = join(cwd, '.deepcode', 'skills', 'broken');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'SKILL.md'), '---\nname: only-name\n---\nbody', 'utf8');
    const skills = await loadSkills({ cwd, home });
    expect(skills).toHaveLength(0);
  });

  it('applies overrides to skip disabled skills', async () => {
    await writeSkill(join(cwd, '.deepcode', 'skills'), 'skip-me', {
      name: 'skip-me',
      description: 'disabled via override',
    });
    await writeSkill(join(cwd, '.deepcode', 'skills'), 'keep', {
      name: 'keep',
      description: 'enabled',
    });
    const skills = await loadSkills({
      cwd,
      home,
      overrides: { 'skip-me': { disabled: true } },
    });
    expect(skills.map((s) => s.qualifiedName)).toEqual(['keep']);
  });

  it('respects `disabled: true` in frontmatter', async () => {
    await writeSkill(join(cwd, '.deepcode', 'skills'), 'inert', {
      name: 'inert',
      description: 'disabled at source',
      disabled: true,
    });
    const skills = await loadSkills({ cwd, home });
    expect(skills).toHaveLength(0);
  });

  it('qualifies plugin skills with plugin name', async () => {
    const plugDir = await mkdtemp(join(tmpdir(), 'dc-plugin-'));
    await writeSkill(join(plugDir, 'skills'), 'plug-skill', {
      name: 'plug-skill',
      description: 'from plugin',
    });
    const skills = await loadSkills({ cwd, home, pluginDirs: [plugDir] });
    expect(skills[0]?.qualifiedName).toMatch(/:plug-skill$/);
    expect(skills[0]?.source).toBe('plugin');
    await rm(plugDir, { recursive: true, force: true });
  });
});

describe('buildSkillsDescriptionBlock', () => {
  it('returns empty string when no skills', () => {
    expect(buildSkillsDescriptionBlock([])).toBe('');
  });

  it('lists name + description per skill', () => {
    const block = buildSkillsDescriptionBlock([
      {
        qualifiedName: 'foo',
        frontmatter: { name: 'foo', description: 'does foo' },
        body: '',
        path: '/x',
        source: 'user',
      },
      {
        qualifiedName: 'bar',
        frontmatter: { name: 'bar', description: 'does bar' },
        body: '',
        path: '/x',
        source: 'user',
      },
    ]);
    expect(block).toMatch(/foo.*does foo/);
    expect(block).toMatch(/bar.*does bar/);
  });
});
