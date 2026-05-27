import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findSubAgent, loadSubAgents } from './loader.js';

async function writeAgent(
  base: string,
  name: string,
  front: Record<string, unknown>,
  body = 'body',
): Promise<void> {
  await fs.mkdir(base, { recursive: true });
  const fm = ['---'];
  for (const [k, v] of Object.entries(front)) {
    if (Array.isArray(v)) fm.push(`${k}: [${v.map((x) => `"${x}"`).join(', ')}]`);
    else if (typeof v === 'number') fm.push(`${k}: ${v}`);
    else fm.push(`${k}: "${v}"`);
  }
  fm.push('---', '', body);
  await fs.writeFile(join(base, `${name}.md`), fm.join('\n'), 'utf8');
}

describe('loadSubAgents', () => {
  let home: string;
  let cwd: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-agents-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'dc-agents-cwd-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('returns [] when none exist', async () => {
    expect(await loadSubAgents({ cwd, home })).toEqual([]);
  });

  it('loads project agent with all fields', async () => {
    await writeAgent(join(cwd, '.deepcode', 'agents'), 'explorer', {
      name: 'explorer',
      description: 'read-only explorer',
      tools: ['Read', 'Grep', 'Glob'],
      model: 'deepseek-chat',
      isolation: 'subprocess',
      maxTurns: 12,
    });
    const agents = await loadSubAgents({ cwd, home });
    expect(agents).toHaveLength(1);
    const a = agents[0]!;
    expect(a.qualifiedName).toBe('explorer');
    expect(a.frontmatter.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect(a.frontmatter.maxTurns).toBe(12);
    expect(a.frontmatter.isolation).toBe('subprocess');
    expect(a.body).toContain('body');
  });

  it('user-level agents alongside project', async () => {
    await writeAgent(join(home, '.deepcode', 'agents'), 'user-agent', {
      name: 'user-agent',
      description: 'user-scoped',
    });
    await writeAgent(join(cwd, '.deepcode', 'agents'), 'proj-agent', {
      name: 'proj-agent',
      description: 'project-scoped',
    });
    const agents = await loadSubAgents({ cwd, home });
    expect(agents.map((a) => a.qualifiedName).sort()).toEqual(['proj-agent', 'user-agent']);
  });

  it('skips malformed', async () => {
    await fs.mkdir(join(cwd, '.deepcode', 'agents'), { recursive: true });
    await fs.writeFile(
      join(cwd, '.deepcode', 'agents', 'bad.md'),
      '---\nname: only-name\n---\nbody',
      'utf8',
    );
    const agents = await loadSubAgents({ cwd, home });
    expect(agents).toHaveLength(0);
  });

  it('projectDirOverride supports --agents CLI flag', async () => {
    const override = await mkdtemp(join(tmpdir(), 'dc-agents-override-'));
    await writeAgent(override, 'overridden', {
      name: 'overridden',
      description: 'from override dir',
    });
    const agents = await loadSubAgents({
      cwd,
      home,
      projectDirOverride: override,
    });
    expect(agents[0]?.qualifiedName).toBe('overridden');
    await rm(override, { recursive: true, force: true });
  });

  it('findSubAgent looks up by qualified name', async () => {
    await writeAgent(join(cwd, '.deepcode', 'agents'), 'finder', {
      name: 'finder',
      description: 'd',
    });
    const agents = await loadSubAgents({ cwd, home });
    expect(findSubAgent(agents, 'finder')?.qualifiedName).toBe('finder');
    expect(findSubAgent(agents, 'no-such')).toBeUndefined();
  });
});
