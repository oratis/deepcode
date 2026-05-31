// NotebookEdit tool — edit a Jupyter .ipynb cell (replace / insert / delete).
// Spec: docs/DEVELOPMENT_PLAN.md §3.2 / §0.1 (parity tool)
//
// Mirrors Claude Code's NotebookEdit. The notebook is read as JSON, the target
// cell located by `cell_id` (its nbformat id, or a numeric index), the edit
// applied, then written back (nbformat-style indent=1).

import { promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface NotebookCell {
  cell_type: 'code' | 'markdown' | string;
  id?: string;
  source: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}
interface Notebook {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

interface NotebookEditInput {
  notebook_path: string;
  new_source: string;
  /** nbformat cell id, or a numeric string index. Omit + insert → prepend. */
  cell_id?: string;
  /** 'replace' (default) | 'insert' | 'delete'. */
  edit_mode?: 'replace' | 'insert' | 'delete';
  /** For insert/replace: 'code' (default) | 'markdown'. */
  cell_type?: 'code' | 'markdown';
}

/** Split into nbformat's canonical source form: each line keeps its trailing \n
 *  (the final line keeps one only if the source ended with a newline). */
function toSourceLines(s: string): string[] {
  if (s === '') return [];
  const out = s.split('\n').map((line) => line + '\n');
  out[out.length - 1] = out[out.length - 1]!.slice(0, -1); // un-add the \n on the last line
  if (out[out.length - 1] === '') out.pop(); // ...and drop it if the source ended in \n
  return out;
}

/** Stable-ish 8-char id for a newly inserted cell (no Math.random dependency). */
let cellSeq = 0;
function newCellId(): string {
  return `dc${Date.now().toString(36)}${(cellSeq++).toString(36)}`.slice(0, 12);
}

/** Find a cell index by nbformat id or numeric index. */
function findCellIndex(cells: NotebookCell[], cellId: string | undefined): number {
  if (cellId === undefined || cellId === '') return -1;
  const byId = cells.findIndex((c) => c.id === cellId);
  if (byId !== -1) return byId;
  const n = Number(cellId);
  if (Number.isInteger(n) && n >= 0 && n < cells.length) return n;
  return -1;
}

export const NotebookEditTool: ToolHandler = {
  name: 'NotebookEdit',
  definition: {
    name: 'NotebookEdit',
    description:
      'Edit a single cell of a Jupyter notebook (.ipynb). edit_mode: "replace" sets the target cell\'s source; "insert" adds a new cell after the target (or at the top if cell_id omitted); "delete" removes the target cell. Identify the cell by its nbformat `cell_id` or a 0-based numeric index.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Absolute path or path relative to cwd.' },
        new_source: { type: 'string', description: 'New cell source (ignored for delete).' },
        cell_id: { type: 'string', description: 'nbformat cell id, or 0-based index as a string.' },
        edit_mode: { type: 'string', enum: ['replace', 'insert', 'delete'] },
        cell_type: { type: 'string', enum: ['code', 'markdown'] },
      },
      required: ['notebook_path', 'new_source'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as NotebookEditInput;
    if (!input?.notebook_path || typeof input.notebook_path !== 'string') {
      return { content: 'Error: notebook_path is required (string).', isError: true };
    }
    const mode = input.edit_mode ?? 'replace';
    const absPath = isAbsolute(input.notebook_path)
      ? input.notebook_path
      : resolve(ctx.cwd, input.notebook_path);

    let nb: Notebook;
    try {
      nb = JSON.parse(await fs.readFile(absPath, 'utf8')) as Notebook;
    } catch (err) {
      return { content: `Error reading notebook: ${(err as Error).message}`, isError: true };
    }
    if (!Array.isArray(nb.cells)) {
      return {
        content: `Error: ${absPath} is not a valid notebook (no cells array).`,
        isError: true,
      };
    }

    const idx = findCellIndex(nb.cells, input.cell_id);

    if (mode === 'delete') {
      if (idx === -1) {
        return { content: `Error: cell "${input.cell_id}" not found to delete.`, isError: true };
      }
      nb.cells.splice(idx, 1);
    } else if (mode === 'insert') {
      const cell: NotebookCell = {
        cell_type: input.cell_type ?? 'code',
        id: newCellId(),
        metadata: {},
        source: toSourceLines(input.new_source ?? ''),
      };
      if (cell.cell_type === 'code') {
        cell.outputs = [];
        cell.execution_count = null;
      }
      // Insert after the target cell, or at the top when no cell_id was given.
      nb.cells.splice(idx === -1 ? 0 : idx + 1, 0, cell);
    } else {
      // replace
      if (idx === -1) {
        return { content: `Error: cell "${input.cell_id}" not found to replace.`, isError: true };
      }
      const cell = nb.cells[idx]!;
      cell.source = toSourceLines(input.new_source ?? '');
      if (input.cell_type) cell.cell_type = input.cell_type;
    }

    try {
      await fs.writeFile(absPath, JSON.stringify(nb, null, 1) + '\n', 'utf8');
    } catch (err) {
      return { content: `Error writing notebook: ${(err as Error).message}`, isError: true };
    }

    return {
      content: `${mode === 'delete' ? 'Deleted' : mode === 'insert' ? 'Inserted' : 'Replaced'} cell in ${input.notebook_path} (now ${nb.cells.length} cells).`,
      data: { mode, cellCount: nb.cells.length },
    };
  },
};
