import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMemory, walkUpwards } from './loader.js';

describe('loadMemory', () => {
  let home: string;
  let cwd: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dc-mem-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'dc-mem-cwd-'));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('returns empty when nothing exists', async () => {
    const m = await loadMemory({ cwd, home });
    expect(m.sources).toHaveLength(0);
    expect(m.text).toBe('');
    expect(m.bytes).toBe(0);
  });

  it('loads user-level DEEPCODE.md', async () => {
    await fs.mkdir(join(home, '.deepcode'), { recursive: true });
    await fs.writeFile(join(home, '.deepcode', 'DEEPCODE.md'), 'user-level memory', 'utf8');
    const m = await loadMemory({ cwd, home });
    expect(m.sources).toHaveLength(1);
    expect(m.text).toContain('user-level memory');
  });

  it('loads project-level DEEPCODE.md', async () => {
    await fs.writeFile(join(cwd, 'DEEPCODE.md'), 'project memory', 'utf8');
    const m = await loadMemory({ cwd, home });
    expect(m.text).toContain('project memory');
  });

  it('auto-imports AGENTS.md', async () => {
    await fs.writeFile(join(cwd, 'AGENTS.md'), 'cross-tool agents content', 'utf8');
    const m = await loadMemory({ cwd, home });
    expect(m.text).toContain('cross-tool agents content');
    expect(m.sources.some((s) => s.label.includes('AGENTS.md'))).toBe(true);
  });

  it('walks upward from cwd loading DEEPCODE.md at each level', async () => {
    const parent = join(cwd, 'parent');
    const child = join(parent, 'child');
    await fs.mkdir(child, { recursive: true });
    await fs.writeFile(join(cwd, 'DEEPCODE.md'), 'root-level', 'utf8');
    await fs.writeFile(join(parent, 'DEEPCODE.md'), 'parent-level', 'utf8');
    await fs.writeFile(join(child, 'DEEPCODE.md'), 'child-level', 'utf8');

    const m = await loadMemory({ cwd: child, home });
    expect(m.text).toContain('root-level');
    expect(m.text).toContain('parent-level');
    expect(m.text).toContain('child-level');
  });

  it('loads .deepcode/rules/*.md', async () => {
    const rulesDir = join(cwd, '.deepcode', 'rules');
    await fs.mkdir(rulesDir, { recursive: true });
    await fs.writeFile(join(rulesDir, 'api.md'), 'API rules', 'utf8');
    await fs.writeFile(join(rulesDir, 'db.md'), 'DB rules', 'utf8');
    const m = await loadMemory({ cwd, home });
    expect(m.text).toContain('API rules');
    expect(m.text).toContain('DB rules');
    expect(m.sources.filter((s) => s.label.startsWith('rule:'))).toHaveLength(2);
  });

  it('expands @-import within DEEPCODE.md', async () => {
    await fs.writeFile(join(cwd, 'DEEPCODE.md'), '@./extra.md\nmain content', 'utf8');
    await fs.writeFile(join(cwd, 'extra.md'), 'extra content from import', 'utf8');
    const m = await loadMemory({ cwd, home });
    expect(m.text).toContain('extra content from import');
    expect(m.text).toContain('main content');
  });

  it('records unresolved imports without crashing', async () => {
    await fs.writeFile(join(cwd, 'DEEPCODE.md'), '@./missing.md\ncontent', 'utf8');
    const m = await loadMemory({ cwd, home });
    expect(m.unresolvedImports.length).toBeGreaterThan(0);
    expect(m.unresolvedImports[0]).toMatch(/missing\.md/);
  });

  it('detects cycles in @-imports', async () => {
    await fs.writeFile(join(cwd, 'DEEPCODE.md'), '@./a.md', 'utf8');
    await fs.writeFile(join(cwd, 'a.md'), '@./b.md\nA', 'utf8');
    await fs.writeFile(join(cwd, 'b.md'), '@./a.md\nB', 'utf8');
    const m = await loadMemory({ cwd, home });
    // Both a and b should be loaded but not infinitely
    expect(m.sources.some((s) => s.label.includes('a.md'))).toBe(true);
    expect(m.sources.some((s) => s.label.includes('b.md'))).toBe(true);
    expect(m.sources.length).toBeLessThan(10); // sanity: no explosion
  });

  it('respects maxBytes budget', async () => {
    const big = 'x'.repeat(100_000);
    await fs.writeFile(join(cwd, 'DEEPCODE.md'), big, 'utf8');
    const m = await loadMemory({ cwd, home, maxBytes: 5_000 });
    expect(m.bytes).toBeLessThanOrEqual(5_100); // small overshoot for "[truncated]" marker
    expect(m.text).toContain('[truncated by memoryLoadCapKB]');
  });

  it('respects maxImportDepth', async () => {
    // a → b → c → d → e — should stop at depth 4 (default)
    await fs.writeFile(join(cwd, 'DEEPCODE.md'), '@./a.md', 'utf8');
    for (const [from, to] of [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
    ]) {
      await fs.writeFile(join(cwd, `${from}.md`), `@./${to}.md\n${from} content`, 'utf8');
    }
    await fs.writeFile(join(cwd, 'e.md'), 'e content', 'utf8');
    const m = await loadMemory({ cwd, home, maxImportDepth: 2 });
    // Depth 2: DEEPCODE.md → a.md → b.md — c onwards should not be loaded
    expect(m.text).toContain('a content');
    expect(m.text).toContain('b content');
    expect(m.text).not.toContain('e content');
  });
});

describe('walkUpwards', () => {
  it('walks from cwd to root', () => {
    const dirs = walkUpwards('/a/b/c/d', '/x'); // boundary not on path → walk to /
    expect(dirs[0]).toBe('/a/b/c/d');
    expect(dirs.at(-1)).toBe('/');
  });

  it('stops at boundary when on path', () => {
    const dirs = walkUpwards('/a/b/c', '/a');
    expect(dirs).toEqual(['/a/b/c', '/a/b', '/a']);
  });

  it('handles cwd == boundary', () => {
    const dirs = walkUpwards('/a', '/a');
    expect(dirs).toEqual(['/a']);
  });
});
