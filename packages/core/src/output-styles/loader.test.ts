import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyStyle, BUILTIN_STYLES, findStyle, loadOutputStyles } from './loader.js';

describe('output styles', () => {
  let home: string;
  let cwd: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-styles-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'dc-styles-cwd-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('ships 4 built-in styles', () => {
    const names = BUILTIN_STYLES.map((s) => s.name);
    expect(names).toEqual(['default', 'explanatory', 'learning', 'proactive']);
  });

  it('loadOutputStyles returns built-ins by default', async () => {
    const styles = await loadOutputStyles({ cwd, home });
    expect(styles.length).toBeGreaterThanOrEqual(4);
  });

  it('user-level style overrides built-in', async () => {
    await fs.mkdir(join(home, '.deepcode', 'output-styles'), { recursive: true });
    await fs.writeFile(
      join(home, '.deepcode', 'output-styles', 'default.md'),
      '---\nname: default\n---\nMy custom default style',
      'utf8',
    );
    const styles = await loadOutputStyles({ cwd, home });
    const def = findStyle(styles, 'default');
    expect(def?.source).toBe('user');
    expect(def?.body).toContain('My custom default style');
  });

  it('project-level style overrides user', async () => {
    await fs.mkdir(join(home, '.deepcode', 'output-styles'), { recursive: true });
    await fs.writeFile(
      join(home, '.deepcode', 'output-styles', 'foo.md'),
      '---\nname: foo\n---\nuser-level foo',
      'utf8',
    );
    await fs.mkdir(join(cwd, '.deepcode', 'output-styles'), { recursive: true });
    await fs.writeFile(
      join(cwd, '.deepcode', 'output-styles', 'foo.md'),
      '---\nname: foo\n---\nproject-level foo',
      'utf8',
    );
    const styles = await loadOutputStyles({ cwd, home });
    expect(findStyle(styles, 'foo')?.body).toContain('project-level');
    expect(findStyle(styles, 'foo')?.source).toBe('project');
  });

  it('applyStyle appends body to base prompt', () => {
    const base = 'You are an assistant.';
    const styled = applyStyle(base, BUILTIN_STYLES[1]); // explanatory
    expect(styled).toContain(base);
    expect(styled).toContain('Output style: explanatory');
    expect(styled).toMatch(/briefly explain why/);
  });

  it('applyStyle is identity for empty body', () => {
    expect(applyStyle('base', BUILTIN_STYLES[0])).toBe('base'); // default has empty body
  });

  it('applyStyle handles undefined style', () => {
    expect(applyStyle('base', undefined)).toBe('base');
  });

  it('findStyle returns undefined on unknown', () => {
    expect(findStyle(BUILTIN_STYLES, 'nonexistent')).toBeUndefined();
  });
});
