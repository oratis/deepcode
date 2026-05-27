import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReadTool } from './read.js';

describe('ReadTool', () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dc-read-'));
    await fs.writeFile(join(tmp, 'short.txt'), 'line one\nline two\nline three\n', 'utf8');
    const longContent = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    await fs.writeFile(join(tmp, 'long.txt'), longContent, 'utf8');
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('reads a file with numbered lines', async () => {
    const r = await ReadTool.execute({ file_path: join(tmp, 'short.txt') }, { cwd: tmp });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('     1\tline one');
    expect(r.content).toContain('     3\tline three');
    expect(r.data?.lines_total).toBe(4); // trailing newline produces a 4th empty line
  });

  it('honors offset and limit', async () => {
    const r = await ReadTool.execute(
      { file_path: join(tmp, 'long.txt'), offset: 10, limit: 3 },
      { cwd: tmp },
    );
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('    10\tline 10');
    expect(r.content).toContain('    12\tline 12');
    expect(r.content).not.toContain('line 13');
  });

  it('resolves relative paths via cwd', async () => {
    const r = await ReadTool.execute({ file_path: 'short.txt' }, { cwd: tmp });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('line two');
  });

  it('reports file not found cleanly', async () => {
    const r = await ReadTool.execute({ file_path: join(tmp, 'missing.txt') }, { cwd: tmp });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/file not found/i);
  });

  it('rejects missing file_path', async () => {
    const r = await ReadTool.execute({}, { cwd: tmp });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/file_path is required/i);
  });

  it('appends "Showing lines" hint when content exceeds limit', async () => {
    const r = await ReadTool.execute({ file_path: join(tmp, 'long.txt'), limit: 5 }, { cwd: tmp });
    expect(r.content).toContain('Showing lines 1-5 of 50');
  });
});
