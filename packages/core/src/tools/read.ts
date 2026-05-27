// Read tool — read a file with line numbers, supports offset + limit for large files.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2 (P0)

import { promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 2000;
const MAX_LINE_WIDTH = 2000;

export const ReadTool: ToolHandler = {
  name: 'Read',
  definition: {
    name: 'Read',
    description:
      'Reads a file from the local filesystem. Returns line-numbered content. Use offset/limit for large files.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path or path relative to cwd.' },
        offset: { type: 'number', description: '1-indexed line to start at.' },
        limit: { type: 'number', description: 'Max lines to return (default 2000).' },
      },
      required: ['file_path'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as ReadInput;
    if (!input?.file_path || typeof input.file_path !== 'string') {
      return { content: 'Error: file_path is required (string).', isError: true };
    }
    const absPath = isAbsolute(input.file_path)
      ? input.file_path
      : resolve(ctx.cwd, input.file_path);

    let raw: string;
    try {
      raw = await fs.readFile(absPath, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        return { content: `Error: file not found: ${absPath}`, isError: true };
      }
      return { content: `Error reading ${absPath}: ${e.message}`, isError: true };
    }

    const lines = raw.split('\n');
    const offset = Math.max(1, input.offset ?? 1);
    const limit = Math.max(1, input.limit ?? DEFAULT_LIMIT);
    const slice = lines.slice(offset - 1, offset - 1 + limit);

    const numbered = slice
      .map((line, i) => {
        const lineNum = offset + i;
        const truncated =
          line.length > MAX_LINE_WIDTH ? line.slice(0, MAX_LINE_WIDTH) + '... [truncated]' : line;
        return `${String(lineNum).padStart(6, ' ')}\t${truncated}`;
      })
      .join('\n');

    const totalLines = lines.length;
    const shown = slice.length;
    const moreNote =
      shown < totalLines - offset + 1
        ? `\n\n[Showing lines ${offset}-${offset + shown - 1} of ${totalLines}. Use offset/limit to see more.]`
        : '';

    return {
      content: numbered + moreNote,
      data: { file: absPath, lines_total: totalLines, lines_shown: shown, offset },
    };
  },
};
