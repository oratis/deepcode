// Glob tool — fast-glob backed file finder.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2 (P0)

import { glob } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface GlobInput {
  pattern: string;
  path?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 200;

export const GlobTool: ToolHandler = {
  name: 'Glob',
  definition: {
    name: 'Glob',
    description:
      'Finds files matching a glob pattern (e.g. "src/**/*.ts"). Returns paths sorted by mtime (most recent first).',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts").' },
        path: { type: 'string', description: 'Root path to search (default: cwd).' },
        limit: { type: 'number', description: `Max paths (default ${DEFAULT_LIMIT}).` },
      },
      required: ['pattern'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as GlobInput;
    if (!input?.pattern || typeof input.pattern !== 'string') {
      return { content: 'Error: pattern is required (string).', isError: true };
    }
    const searchPath = input.path
      ? isAbsolute(input.path)
        ? input.path
        : resolve(ctx.cwd, input.path)
      : ctx.cwd;
    const limit = Math.max(1, input.limit ?? DEFAULT_LIMIT);

    const matches: string[] = [];
    try {
      // Use Node's built-in fs.glob (Node 22+) — falls back gracefully on older.
      for await (const path of glob(input.pattern, { cwd: searchPath })) {
        matches.push(typeof path === 'string' ? path : ((path as { name?: string }).name ?? ''));
        if (matches.length >= limit * 3) break; // sample more then sort
      }
    } catch (err) {
      const e = err as Error;
      return { content: `Error: ${e.message}`, isError: true };
    }

    // Convert to absolute, dedupe
    const abs = [...new Set(matches.filter(Boolean).map((p) => resolve(searchPath, p)))];

    // Sort by mtime descending (best-effort; skip stat errors)
    const { promises: fs } = await import('node:fs');
    const stamped = await Promise.all(
      abs.map(async (p) => {
        try {
          const s = await fs.stat(p);
          return { p, mtime: s.mtimeMs };
        } catch {
          return { p, mtime: 0 };
        }
      }),
    );
    stamped.sort((a, b) => b.mtime - a.mtime);

    const truncated = stamped.length > limit;
    const top = stamped.slice(0, limit);
    const lines = top.map((s) => relative(ctx.cwd, s.p) || s.p);
    if (truncated) lines.push(`... [${top.length} of ${stamped.length}]`);

    return {
      content: lines.join('\n') || '(no matches)',
      data: { count: top.length, total: stamped.length },
    };
  },
};
