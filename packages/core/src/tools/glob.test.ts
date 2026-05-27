import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GlobTool } from './glob.js';

describe('GlobTool', () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dc-glob-'));
    await fs.mkdir(join(tmp, 'src'), { recursive: true });
    await fs.mkdir(join(tmp, 'src/nested'), { recursive: true });
    await fs.writeFile(join(tmp, 'src/a.ts'), 'a');
    await fs.writeFile(join(tmp, 'src/b.ts'), 'b');
    await fs.writeFile(join(tmp, 'src/nested/c.ts'), 'c');
    await fs.writeFile(join(tmp, 'src/d.md'), 'd');
  });
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('finds files by extension', async () => {
    const r = await GlobTool.execute({ pattern: '**/*.ts', path: tmp }, { cwd: tmp });
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/a\.ts/);
    expect(r.content).toMatch(/b\.ts/);
    expect(r.content).toMatch(/c\.ts/);
    expect(r.content).not.toMatch(/d\.md/);
  });

  it('honors limit', async () => {
    const r = await GlobTool.execute({ pattern: '**/*.ts', path: tmp, limit: 1 }, { cwd: tmp });
    expect(r.isError).toBeFalsy();
    const lines = (r.content as string).split('\n').filter(Boolean);
    // 1 result + 1 truncation marker line
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it('returns (no matches) cleanly', async () => {
    const r = await GlobTool.execute({ pattern: '**/*.xyz', path: tmp }, { cwd: tmp });
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/no matches/i);
  });

  it('rejects missing pattern', async () => {
    const r = await GlobTool.execute({}, { cwd: tmp });
    expect(r.isError).toBe(true);
  });
});
