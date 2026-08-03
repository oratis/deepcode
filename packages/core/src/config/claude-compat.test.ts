// Reading a Claude Code user's existing assets in place.
//
// The migration guide asked people to `mv ~/.claude/... ~/.deepcode/...` before
// DeepCode would see anything they had. That is five steps of grit in front of
// `npm i -g deepcode-cli && deepcode`, and it is the first thing a migrating
// user hits.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, resolveUserSettingsPath } from './loader.js';
import { loadMemory } from '../memory/loader.js';
import { loadSkills } from '../skills/loader.js';
import { loadSubAgents } from '../sub-agents/loader.js';

let home: string;
let cwd: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dc-claude-compat-'));
  cwd = join(home, 'project');
  await mkdir(cwd, { recursive: true });
});

const writeAt = async (path: string, body: string): Promise<void> => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body, 'utf8');
};

describe('settings', () => {
  it('reads ~/.claude/settings.json when DeepCode has none', async () => {
    await writeAt(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'from-claude' }));
    expect(await resolveUserSettingsPath({ cwd, home })).toBe(join(home, '.claude/settings.json'));
    const loaded = await loadSettings({ cwd, home });
    expect(loaded.merged.model).toBe('from-claude');
  });

  it('prefers DeepCode settings outright when both exist', async () => {
    await writeAt(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'from-claude' }));
    await writeAt(
      join(home, '.deepcode', 'settings.json'),
      JSON.stringify({ effortLevel: 'high' }),
    );
    const loaded = await loadSettings({ cwd, home });
    expect(loaded.merged.effortLevel).toBe('high');
    // A fallback, not an extra layer — no silent merge from the other file.
    expect(loaded.merged.model).toBeUndefined();
    expect(loaded.sources.userPath).toBe(join(home, '.deepcode/settings.json'));
  });

  it('names the file it actually read, so provenance stays honest', async () => {
    await writeAt(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'from-claude' }));
    const loaded = await loadSettings({ cwd, home });
    expect(loaded.sources.userPath).toContain('.claude');
    expect(Object.values(loaded.provenance)).toContainEqual(
      expect.objectContaining({ path: join(home, '.claude/settings.json') }),
    );
  });

  it('does not fall back when an explicit data directory is given', async () => {
    await writeAt(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'from-claude' }));
    const directory = join(home, 'explicit');
    expect(await resolveUserSettingsPath({ cwd, home, directory })).toBe(
      join(directory, 'settings.json'),
    );
  });

  it('does not read a project .claude/settings.json — that path is trust-gated', async () => {
    await writeAt(join(cwd, '.claude', 'settings.json'), JSON.stringify({ model: 'untrusted' }));
    const loaded = await loadSettings({ cwd, home });
    expect(loaded.merged.model).toBeUndefined();
  });
});

describe('memory', () => {
  it('reads ~/.claude/CLAUDE.md', async () => {
    await writeAt(join(home, '.claude', 'CLAUDE.md'), 'global claude instructions');
    const memory = await loadMemory({ cwd, home });
    expect(memory.text).toContain('global claude instructions');
  });

  it('reads a project CLAUDE.md', async () => {
    await writeAt(join(cwd, 'CLAUDE.md'), 'project claude instructions');
    const memory = await loadMemory({ cwd, home });
    expect(memory.text).toContain('project claude instructions');
  });

  it('places DEEPCODE.md after CLAUDE.md at the same level, so it wins', async () => {
    await writeAt(join(cwd, 'CLAUDE.md'), 'claude says');
    await writeAt(join(cwd, 'DEEPCODE.md'), 'deepcode says');
    const memory = await loadMemory({ cwd, home });
    expect(memory.text.indexOf('claude says')).toBeLessThan(memory.text.indexOf('deepcode says'));
  });
});

describe('skills and agents', () => {
  it('loads skills from ~/.claude/skills', async () => {
    await writeAt(
      join(home, '.claude', 'skills', 'greet', 'SKILL.md'),
      '---\nname: greet\ndescription: say hi\n---\nbody',
    );
    const skills = await loadSkills({ cwd, home });
    expect(skills.map((s) => s.qualifiedName)).toContain('greet');
  });

  it('lets a DeepCode skill shadow a same-named Claude Code one', async () => {
    await writeAt(
      join(home, '.claude', 'skills', 'greet', 'SKILL.md'),
      '---\nname: greet\ndescription: from claude\n---\nbody',
    );
    await writeAt(
      join(home, '.deepcode', 'skills', 'greet', 'SKILL.md'),
      '---\nname: greet\ndescription: from deepcode\n---\nbody',
    );
    const skills = (await loadSkills({ cwd, home })).filter((s) => s.qualifiedName === 'greet');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.frontmatter.description).toBe('from deepcode');
  });

  it('loads sub-agents from ~/.claude/agents, with DeepCode winning collisions', async () => {
    await writeAt(
      join(home, '.claude', 'agents', 'scout.md'),
      '---\nname: scout\ndescription: from claude\n---\nbody',
    );
    const fromClaude = await loadSubAgents({ cwd, home });
    expect(fromClaude.map((a) => a.qualifiedName)).toContain('scout');

    await writeAt(
      join(home, '.deepcode', 'agents', 'scout.md'),
      '---\nname: scout\ndescription: from deepcode\n---\nbody',
    );
    const both = (await loadSubAgents({ cwd, home })).filter((a) => a.qualifiedName === 'scout');
    expect(both).toHaveLength(1);
    expect(both[0]!.frontmatter.description).toBe('from deepcode');
  });
});
