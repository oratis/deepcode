import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EditTool } from './edit.js';

describe('EditTool', () => {
  let tmp: string;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dc-edit-'));
  });
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('does not write when cancelled while reading the original file', async () => {
    const path = join(tmp, 'cancelled.txt');
    await fs.writeFile(path, 'before');
    const controller = new AbortController();
    const originalReadFile = fs.readFile;
    const mock = vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      const result = await originalReadFile(...args);
      controller.abort();
      return result;
    });
    try {
      const result = await EditTool.execute(
        { file_path: path, old_string: 'before', new_string: 'after' },
        { cwd: tmp, signal: controller.signal },
      );
      expect(result.isError).toBe(true);
      expect(await originalReadFile(path, 'utf8')).toBe('before');
    } finally {
      mock.mockRestore();
    }
  });

  it('replaces a unique occurrence', async () => {
    const path = join(tmp, 'a.txt');
    await fs.writeFile(path, 'hello world\nbye world');
    const r = await EditTool.execute(
      { file_path: path, old_string: 'hello world', new_string: 'HELLO WORLD' },
      { cwd: tmp },
    );
    expect(r.isError).toBeFalsy();
    expect(await fs.readFile(path, 'utf8')).toBe('HELLO WORLD\nbye world');
    expect(r.data?.replacements).toBe(1);
  });

  it('fails on non-unique match without replace_all', async () => {
    const path = join(tmp, 'b.txt');
    await fs.writeFile(path, 'foo foo foo');
    const r = await EditTool.execute(
      { file_path: path, old_string: 'foo', new_string: 'bar' },
      { cwd: tmp },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/3 occurrences/);
  });

  it('replaces every occurrence with replace_all', async () => {
    const path = join(tmp, 'c.txt');
    await fs.writeFile(path, 'foo foo foo');
    const r = await EditTool.execute(
      { file_path: path, old_string: 'foo', new_string: 'bar', replace_all: true },
      { cwd: tmp },
    );
    expect(r.isError).toBeFalsy();
    expect(await fs.readFile(path, 'utf8')).toBe('bar bar bar');
    expect(r.data?.replacements).toBe(3);
  });

  it('fails when old_string not found', async () => {
    const path = join(tmp, 'd.txt');
    await fs.writeFile(path, 'content');
    const r = await EditTool.execute(
      { file_path: path, old_string: 'missing', new_string: 'x' },
      { cwd: tmp },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not found/i);
  });

  it('fails when old_string equals new_string', async () => {
    const path = join(tmp, 'e.txt');
    await fs.writeFile(path, 'same');
    const r = await EditTool.execute(
      { file_path: path, old_string: 'x', new_string: 'x' },
      { cwd: tmp },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/must differ/i);
  });

  it('rejects empty old_string', async () => {
    const path = join(tmp, 'f.txt');
    await fs.writeFile(path, 'content');
    const r = await EditTool.execute(
      { file_path: path, old_string: '', new_string: 'x' },
      { cwd: tmp },
    );
    expect(r.isError).toBe(true);
  });
});
