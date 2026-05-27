// Grep tool — searches via ripgrep (rg) for high performance, falls back to grep.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2 (P0)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

const execFileAsync = promisify(execFile);

interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  '-i'?: boolean;
  '-n'?: boolean;
  head_limit?: number;
}

export const GrepTool: ToolHandler = {
  name: 'Grep',
  definition: {
    name: 'Grep',
    description:
      'Searches for a regex pattern using ripgrep (rg). Supports globs, file types, case-insensitive matching.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern (rg syntax).' },
        path: { type: 'string', description: 'Path to search (default: cwd).' },
        glob: { type: 'string', description: 'Glob filter (e.g. "*.ts").' },
        type: { type: 'string', description: 'File type (rg --type, e.g. "ts").' },
        output_mode: {
          type: 'string',
          enum: ['content', 'files_with_matches', 'count'],
          description: 'Output style (default content).',
        },
        '-i': { type: 'boolean', description: 'Case-insensitive.' },
        '-n': { type: 'boolean', description: 'Show line numbers (content mode).' },
        head_limit: { type: 'number', description: 'Max lines to return.' },
      },
      required: ['pattern'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as GrepInput;
    if (!input?.pattern || typeof input.pattern !== 'string') {
      return { content: 'Error: pattern is required (string).', isError: true };
    }

    const searchPath = input.path
      ? isAbsolute(input.path)
        ? input.path
        : resolve(ctx.cwd, input.path)
      : ctx.cwd;

    const args: string[] = [];
    args.push('--color=never');
    args.push('--max-columns=500');
    if (input['-i']) args.push('-i');
    if (input.type) args.push('--type', input.type);
    if (input.glob) args.push('--glob', input.glob);

    const mode = input.output_mode ?? 'content';
    if (mode === 'files_with_matches') args.push('-l');
    else if (mode === 'count') args.push('-c');
    else if (input['-n']) args.push('-n');

    args.push('--', input.pattern, searchPath);

    let stdout = '';
    try {
      const result = await execFileAsync('rg', args, {
        cwd: ctx.cwd,
        maxBuffer: 5_000_000,
        signal: ctx.signal,
      });
      stdout = result.stdout;
    } catch (err) {
      const e = err as {
        code?: number | string;
        stderr?: string;
        stdout?: string;
        message?: string;
      };
      // rg exits 1 when no matches — that's not an error
      if (e.code === 1) {
        return { content: '(no matches)', data: { matches: 0 } };
      }
      if (e.code === 'ENOENT') {
        return {
          content:
            'Error: ripgrep (rg) not found on PATH. Install via `brew install ripgrep` or `apt install ripgrep`.',
          isError: true,
        };
      }
      return {
        content: `Error running rg: ${e.stderr ?? e.message ?? 'unknown'}`,
        isError: true,
      };
    }

    let lines = stdout.split('\n').filter(Boolean);
    if (input.head_limit && input.head_limit > 0) {
      const truncated = lines.length > input.head_limit;
      lines = lines.slice(0, input.head_limit);
      if (truncated)
        lines.push(`... [${lines.length} of ${stdout.split('\n').filter(Boolean).length}]`);
    }

    return {
      content: lines.join('\n') || '(no matches)',
      data: { mode, matches: lines.length },
    };
  },
};
