// Write tool — write entire file contents. Creates parent directories if needed.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2 (P0)
// Safety: must Read before overwriting existing files (enforced at agent level, not here).

import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface WriteInput {
  file_path: string;
  content: string;
}

export const WriteTool: ToolHandler = {
  name: 'Write',
  definition: {
    name: 'Write',
    description:
      'Writes content to a file. Creates parent directories if needed. Overwrites existing file.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute or cwd-relative path.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['file_path', 'content'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as WriteInput;
    if (!input?.file_path || typeof input.file_path !== 'string') {
      return { content: 'Error: file_path is required (string).', isError: true };
    }
    if (typeof input.content !== 'string') {
      return { content: 'Error: content is required (string).', isError: true };
    }
    const absPath = isAbsolute(input.file_path)
      ? input.file_path
      : resolve(ctx.cwd, input.file_path);

    try {
      await fs.mkdir(dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, input.content, 'utf8');
    } catch (err) {
      const e = err as Error;
      return { content: `Error writing ${absPath}: ${e.message}`, isError: true };
    }

    const lines = input.content.split('\n').length;
    return {
      content: `File created/updated: ${absPath} (${lines} lines, ${input.content.length} bytes).`,
      data: { file: absPath, lines, bytes: input.content.length },
    };
  },
};
