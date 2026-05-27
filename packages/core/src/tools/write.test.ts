import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WriteTool } from './write.js';

describe('WriteTool', () => {
  let tmp: string;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dc-write-'));
  });
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes a new file', async () => {
    const path = join(tmp, 'hello.txt');
    const r = await WriteTool.execute({ file_path: path, content: 'hi\n' }, { cwd: tmp });
    expect(r.isError).toBeFalsy();
    const got = await fs.readFile(path, 'utf8');
    expect(got).toBe('hi\n');
    expect(r.data?.bytes).toBe(3);
  });

  it('creates parent directories', async () => {
    const path = join(tmp, 'a/b/c/deep.txt');
    const r = await WriteTool.execute({ file_path: path, content: 'deep' }, { cwd: tmp });
    expect(r.isError).toBeFalsy();
    expect(await fs.readFile(path, 'utf8')).toBe('deep');
  });

  it('overwrites existing files', async () => {
    const path = join(tmp, 'over.txt');
    await fs.writeFile(path, 'old');
    await WriteTool.execute({ file_path: path, content: 'new' }, { cwd: tmp });
    expect(await fs.readFile(path, 'utf8')).toBe('new');
  });

  it('resolves relative paths', async () => {
    const r = await WriteTool.execute(
      { file_path: 'rel.txt', content: 'rel-content' },
      { cwd: tmp },
    );
    expect(r.isError).toBeFalsy();
    expect(await fs.readFile(join(tmp, 'rel.txt'), 'utf8')).toBe('rel-content');
  });

  it('rejects missing args', async () => {
    expect((await WriteTool.execute({ content: 'x' }, { cwd: tmp })).isError).toBe(true);
    expect((await WriteTool.execute({ file_path: join(tmp, 'x.txt') }, { cwd: tmp })).isError).toBe(
      true,
    );
  });
});
