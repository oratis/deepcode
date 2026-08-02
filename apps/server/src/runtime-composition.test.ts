import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { composeRuntime, resolveComposedMode } from './runtime-composition.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe('composeRuntime', () => {
  it('uses trusted settings mode unless the client explicitly overrides it', () => {
    const settings = { permissions: { defaultMode: 'plan' as const } };
    expect(resolveComposedMode('default', false, settings)).toBe('plan');
    expect(resolveComposedMode('auto', true, settings)).toBe('auto');
  });

  it('assembles memory, AGENTS, skills, style, hooks, and model defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dc-composition-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'dc-composition-cwd-'));
    roots.push(directory, cwd);
    await writeFile(join(directory, 'DEEPCODE.md'), 'User-level instructions.');
    await writeFile(join(cwd, 'AGENTS.md'), 'Project agent instructions.');
    await mkdir(join(directory, 'skills', 'verify'), { recursive: true });
    await writeFile(
      join(directory, 'skills', 'verify', 'SKILL.md'),
      '---\nname: verify\ndescription: Verify the result.\n---\nRun the relevant tests.',
    );
    await mkdir(join(directory, 'output-styles'), { recursive: true });
    await writeFile(
      join(directory, 'output-styles', 'focused.md'),
      '---\nname: focused\n---\nReport only material findings.',
    );

    const composition = await composeRuntime({
      cwd,
      directory,
      settings: {
        model: 'deepseek-reasoner',
        effortLevel: 'high',
        outputStyle: 'focused',
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: 'prompt', prompt: 'Additional hook context.' }] }],
        },
      },
    });

    expect(composition.systemPrompt).toContain('User-level instructions.');
    expect(composition.systemPrompt).toContain('Project agent instructions.');
    expect(composition.systemPrompt).toContain('verify');
    expect(composition.systemPrompt).toContain('Report only material findings.');
    expect(composition.tools.get('Read')).toBeDefined();
    expect(composition.tools.get('Bash')).toBeDefined();
    expect(composition.tools.get('Skill')).toBeDefined();
    expect(composition.model).toBe('deepseek-reasoner');
    expect(composition.effort).toBe('high');
    await expect(
      composition.hooks.dispatch({
        event: 'UserPromptSubmit',
        cwd,
        triggeredAt: '2026-08-01T00:00:00.000Z',
        payload: { prompt: 'test' },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ stdout: expect.stringContaining('hook context') }),
    );
  });
});
