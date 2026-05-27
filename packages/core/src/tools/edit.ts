// Edit tool — exact-string replacement with replace_all option.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2 (P0)
// Behavior aligned with Claude Code's Edit tool — fails if old_string not found OR not unique.

import { promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export const EditTool: ToolHandler = {
  name: 'Edit',
  definition: {
    name: 'Edit',
    description:
      'Replaces exact text in a file. old_string must be unique unless replace_all=true. ' +
      'old_string and new_string must differ.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute or cwd-relative path.' },
        old_string: { type: 'string', description: 'Exact text to find.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence (default false).',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as EditInput;
    if (!input?.file_path) {
      return { content: 'Error: file_path is required.', isError: true };
    }
    if (typeof input.old_string !== 'string' || typeof input.new_string !== 'string') {
      return { content: 'Error: old_string and new_string must both be strings.', isError: true };
    }
    if (input.old_string === input.new_string) {
      return { content: 'Error: old_string and new_string must differ.', isError: true };
    }
    if (input.old_string === '') {
      return { content: 'Error: old_string must not be empty.', isError: true };
    }

    const absPath = isAbsolute(input.file_path)
      ? input.file_path
      : resolve(ctx.cwd, input.file_path);

    let raw: string;
    try {
      raw = await fs.readFile(absPath, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      return { content: `Error reading ${absPath}: ${e.message}`, isError: true };
    }

    const matchCount = countOccurrences(raw, input.old_string);
    if (matchCount === 0) {
      return {
        content: `Error: old_string not found in ${absPath}.`,
        isError: true,
      };
    }
    if (matchCount > 1 && !input.replace_all) {
      return {
        content: `Error: old_string matched ${matchCount} occurrences. Pass replace_all=true or expand old_string for uniqueness.`,
        isError: true,
      };
    }

    const next = input.replace_all
      ? raw.split(input.old_string).join(input.new_string)
      : raw.replace(input.old_string, input.new_string);

    try {
      await fs.writeFile(absPath, next, 'utf8');
    } catch (err) {
      return { content: `Error writing ${absPath}: ${(err as Error).message}`, isError: true };
    }

    const replaced = input.replace_all ? matchCount : 1;
    return {
      content: `Edited ${absPath} (${replaced} replacement${replaced > 1 ? 's' : ''}).`,
      data: { file: absPath, replacements: replaced },
    };
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}
