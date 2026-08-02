import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { diagnoseSettings } from './diagnostics.js';
import { writeSettings } from './loader.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

describe('diagnoseSettings', () => {
  it('reports sources, validation, and trust gating without returning values', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dc-diagnostics-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'dc-diagnostics-cwd-'));
    roots.push(home, cwd);
    await writeSettings(join(home, '.deepcode', 'settings.json'), { model: 'deepseek-chat' });
    await writeSettings(join(cwd, '.deepcode', 'settings.json'), {
      permissions: { allow: ['Bash'] },
      effortLevel: 'turbo' as 'max',
      env: { SECRET_VALUE: 'never-export-this' },
    });

    const report = await diagnoseSettings({ cwd, home, trustStatus: 'untrusted' });
    expect(report.trustStatus).toBe('untrusted');
    expect(report.gated).toEqual(['effortLevel', 'permissions', 'env']);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'schema_validation', severity: 'error' }),
        expect.objectContaining({
          code: 'untrusted_setting_gated',
          pointer: '/permissions',
          source: expect.objectContaining({ layer: 'project' }),
        }),
      ]),
    );
    expect(report.layers.find((layer) => layer.layer === 'project')).toEqual(
      expect.objectContaining({ present: true, trusted: false }),
    );
    expect(JSON.stringify(report)).not.toContain('never-export-this');
  });

  it('marks project layers trusted and emits no gate warnings after trust', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dc-diagnostics-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'dc-diagnostics-cwd-'));
    roots.push(home, cwd);
    await writeSettings(join(cwd, '.deepcode', 'settings.json'), {
      permissions: { allow: ['Read'] },
    });

    const report = await diagnoseSettings({ cwd, home, trustStatus: 'trusted' });
    expect(report.gated).toEqual([]);
    expect(report.issues).toEqual([]);
    expect(report.layers.find((layer) => layer.layer === 'project')?.trusted).toBe(true);
  });
});
