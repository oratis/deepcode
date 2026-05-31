import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotebookEditTool } from './notebook.js';

interface NbCell {
  cell_type: string;
  id?: string;
  source: string | string[];
  outputs?: unknown[];
}

describe('NotebookEditTool', () => {
  let cwd: string;
  const nbName = 'nb.ipynb';

  function makeNb(): string {
    return JSON.stringify({
      cells: [
        { cell_type: 'code', id: 'c1', source: ['print(1)\n'], outputs: [], execution_count: null },
        { cell_type: 'markdown', id: 'c2', source: ['# title\n'] },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    });
  }
  async function readCells(): Promise<NbCell[]> {
    return JSON.parse(await readFile(join(cwd, nbName), 'utf8')).cells as NbCell[];
  }

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-nb-'));
    await writeFile(join(cwd, nbName), makeNb());
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('replaces a cell by id (source stored as nbformat lines)', async () => {
    const r = await NotebookEditTool.execute(
      { notebook_path: nbName, cell_id: 'c1', new_source: 'print(2)\nprint(3)' },
      { cwd },
    );
    expect(r.isError).toBeFalsy();
    const cells = await readCells();
    expect(cells[0]!.source).toEqual(['print(2)\n', 'print(3)']);
    expect(cells).toHaveLength(2);
  });

  it('replaces a cell by numeric index', async () => {
    await NotebookEditTool.execute(
      { notebook_path: nbName, cell_id: '1', new_source: '# new', edit_mode: 'replace' },
      { cwd },
    );
    const cells = await readCells();
    expect(cells[1]!.source).toEqual(['# new']);
  });

  it('inserts a new code cell after the target (with id + outputs)', async () => {
    const r = await NotebookEditTool.execute(
      { notebook_path: nbName, cell_id: 'c1', new_source: 'x = 1', edit_mode: 'insert' },
      { cwd },
    );
    expect(r.isError).toBeFalsy();
    const cells = await readCells();
    expect(cells).toHaveLength(3);
    expect(cells[1]!.source).toEqual(['x = 1']);
    expect(cells[1]!.cell_type).toBe('code');
    expect(typeof cells[1]!.id).toBe('string');
    expect(cells[1]!.outputs).toEqual([]);
  });

  it('insert with no cell_id prepends', async () => {
    await NotebookEditTool.execute(
      { notebook_path: nbName, new_source: 'top', edit_mode: 'insert', cell_type: 'markdown' },
      { cwd },
    );
    const cells = await readCells();
    expect(cells[0]!.source).toEqual(['top']);
    expect(cells[0]!.cell_type).toBe('markdown');
  });

  it('deletes a cell by id', async () => {
    const r = await NotebookEditTool.execute(
      { notebook_path: nbName, cell_id: 'c2', new_source: '', edit_mode: 'delete' },
      { cwd },
    );
    expect(r.isError).toBeFalsy();
    const cells = await readCells();
    expect(cells).toHaveLength(1);
    expect(cells[0]!.id).toBe('c1');
  });

  it('errors on unknown cell_id for replace/delete', async () => {
    const r = await NotebookEditTool.execute(
      { notebook_path: nbName, cell_id: 'nope', new_source: 'x', edit_mode: 'replace' },
      { cwd },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not found/);
  });

  it('errors on a non-notebook file', async () => {
    await writeFile(join(cwd, 'bad.ipynb'), '{"not":"a notebook"}');
    const r = await NotebookEditTool.execute(
      { notebook_path: 'bad.ipynb', new_source: 'x' },
      { cwd },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not a valid notebook/);
  });
});
