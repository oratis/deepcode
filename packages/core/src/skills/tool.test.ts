import { describe, expect, it } from 'vitest';
import type { Skill } from './loader.js';
import { makeSkillTool } from './tool.js';

const fixtures: Skill[] = [
  {
    qualifiedName: 'code-review',
    frontmatter: {
      name: 'code-review',
      description: 'Review diff for bugs.',
    },
    body: 'You are reviewing. Steps: 1) git diff. 2) Note issues.',
    path: '/x/code-review/SKILL.md',
    source: 'builtin',
  },
  {
    qualifiedName: 'plugin-x:do-thing',
    frontmatter: { name: 'do-thing', description: 'A plugin skill.' },
    body: 'Do the thing.',
    path: '/x/plugin/SKILL.md',
    source: 'plugin',
  },
];

describe('Skill tool', () => {
  it('exposes a Skill ToolHandler', () => {
    const t = makeSkillTool(fixtures);
    expect(t.name).toBe('Skill');
    expect(t.definition.name).toBe('Skill');
    expect(t.definition.inputSchema).toBeDefined();
  });

  it('returns skill body when invoked with known name', async () => {
    const t = makeSkillTool(fixtures);
    const r = await t.execute({ skill: 'code-review' }, { cwd: '/tmp' });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('Skill loaded: code-review');
    expect(r.content).toContain('git diff');
  });

  it('appends user args when provided', async () => {
    const t = makeSkillTool(fixtures);
    const r = await t.execute({ skill: 'code-review', args: 'only check src/' }, { cwd: '/tmp' });
    expect(r.content).toContain('User-supplied args: only check src/');
  });

  it('matches plugin-qualified names', async () => {
    const t = makeSkillTool(fixtures);
    const r = await t.execute({ skill: 'plugin-x:do-thing' }, { cwd: '/tmp' });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('Do the thing.');
  });

  it('errors clearly when skill is missing', async () => {
    const t = makeSkillTool(fixtures);
    const r = await t.execute({ skill: 'no-such-skill' }, { cwd: '/tmp' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not found/);
    expect(r.content).toMatch(/Known:/);
  });

  it('errors when skill arg missing', async () => {
    const t = makeSkillTool(fixtures);
    const r = await t.execute({}, { cwd: '/tmp' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/required/i);
  });
});
