import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFileContract } from '../config/file-contract.js';
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

  it('attaches locations: absolute for opening, relative as displayed', async () => {
    const r = await GlobTool.execute({ pattern: '**/*.ts', path: tmp }, { cwd: tmp });
    const locs = (r.data?.locations ?? []) as Array<{ path: string; display?: string }>;
    expect(locs.length).toBe(3);
    for (const loc of locs) {
      expect(loc.path.startsWith(tmp)).toBe(true);
      expect(loc.display).toBe(loc.path.slice(tmp.length + 1));
    }
    // Entries line up with the listing, in the same (mtime) order.
    const listed = (r.content as string).split('\n').filter(Boolean);
    expect(locs.map((l) => l.display)).toEqual(listed);
  });

  it('slices locations with limit, so the marker line has no entry', async () => {
    const r = await GlobTool.execute({ pattern: '**/*.ts', path: tmp, limit: 1 }, { cwd: tmp });
    expect((r.data?.locations as unknown[]).length).toBe(1);
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

  describe('file contract', () => {
    const denySecrets = parseFileContract(
      ['version: 1', 'rules:', '  - glob: "src/nested/**"', '    read: deny'].join('\n'),
    );

    it('withholds denied paths from the listing', async () => {
      const r = await GlobTool.execute(
        { pattern: '**/*.ts', path: tmp },
        { cwd: tmp, contract: denySecrets },
      );
      expect(r.content).toMatch(/a\.ts/);
      expect(r.content).not.toMatch(/c\.ts/);
      expect(r.content).toMatch(/1 result withheld by the file contract/);
      expect(r.data?.withheld).toBe(1);
    });

    it('leaves the listing alone when nothing is denied', async () => {
      const withContract = await GlobTool.execute(
        { pattern: '**/*.ts', path: tmp },
        { cwd: tmp, contract: parseFileContract('version: 1\n') },
      );
      const without = await GlobTool.execute({ pattern: '**/*.ts', path: tmp }, { cwd: tmp });
      expect(withContract.content).toBe(without.content);
      expect(withContract.data?.withheld).toBeUndefined();
    });

    it('does not count denied paths against the limit', async () => {
      // Filtering after truncation would let denied entries eat result slots,
      // so a search could come back empty while matches existed.
      const r = await GlobTool.execute(
        { pattern: '**/*.ts', path: tmp, limit: 2 },
        { cwd: tmp, contract: denySecrets },
      );
      const paths = (r.content as string).split('\n').filter((l) => l.endsWith('.ts'));
      expect(paths).toHaveLength(2);
      expect(paths.every((p) => !p.includes('nested'))).toBe(true);
    });
  });
});
