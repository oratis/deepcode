// Grep tool — searches via ripgrep (rg) for high performance, falls back to grep.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2 (P0)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, resolve } from 'node:path';
import { withheldNotice, withholdDeniedReads } from '../config/contract-dispatch.js';
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

/**
 * One ripgrep output record: the path it printed, and whatever followed.
 *
 * Both halves are nullable because rg genuinely omits either one, and `''` is a
 * value it can also print. `path: null` means rg printed no filename — it does
 * that when the search path is a single *file*, since there is nothing to
 * disambiguate. `text: null` means it printed the path alone, as
 * `files_with_matches` does. Collapsing either onto `''` loses the distinction
 * between "absent" and "empty", and the separator is reinstated from it.
 */
export interface RipgrepRow {
  path: string | null;
  text: string | null;
}

/**
 * Split `--null` output back into (path, rest) pairs.
 *
 * `--null` does not mean one thing. In `content` and `count` modes it puts a NUL
 * *after the path* and still ends each record with a newline. In
 * `files_with_matches` it uses the NUL as the record terminator and emits no
 * newlines at all — so splitting that output on '\n' yields a single line with
 * every path concatenated, and a filter reading only its first field would drop
 * nothing while appearing to work.
 *
 * The reason for `--null` at all is that the default `:` separator is not
 * reversible: `src/od:d.ts:1:hit` has three plausible readings, and picking
 * wrong means withholding the wrong file — or failing to withhold the right one.
 *
 * A record with no NUL is one rg printed without a filename: either the search
 * path was a single file, or it is rg's `--` context separator. Neither has an
 * attributable path, so both come back as `path: null` and pass through.
 */
export function parseRipgrepRows(stdout: string, mode: GrepInput['output_mode']): RipgrepRow[] {
  if (mode === 'files_with_matches') {
    // NUL terminates the record and nothing follows the path.
    return stdout
      .split('\0')
      .filter(Boolean)
      .map((path) => ({ path, text: null }));
  }
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((raw) => {
      const nul = raw.indexOf('\0');
      return nul === -1
        ? { path: null, text: raw }
        : { path: raw.slice(0, nul), text: raw.slice(nul + 1) };
    });
}

/**
 * Undo `--null`, reproducing rg's default output byte for byte.
 *
 * The separator is written back only where rg wrote one. Give a single file as
 * the search path and rg prints `1:hit` with no filename at all — emitting
 * `path + ':' + text` there would prepend a colon to every line of a result set
 * that was previously correct.
 */
export function formatRipgrepRow(row: RipgrepRow): string {
  if (row.path === null) return row.text ?? '';
  if (row.text === null) return row.path;
  return `${row.path}:${row.text}`;
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
    // `--null` puts a NUL after every printed path, in every output mode. The
    // default `:` separator cannot be parsed back: a path may contain a colon,
    // so `a:b:c` is ambiguous and guessing wrong would withhold the wrong line
    // — or fail to withhold the right one. `--no-heading` pins the shape rather
    // than relying on rg's TTY detection. Both are undone before returning, so
    // the visible output is byte-identical to before.
    args.push('--null');
    args.push('--no-heading');
    if (input['-i']) args.push('-i');
    if (input.type) args.push('--type', input.type);
    if (input.glob) args.push('--glob', input.glob);

    const mode = input.output_mode ?? 'content';
    if (mode === 'files_with_matches') args.push('-l');
    else if (mode === 'count') args.push('-c');
    else if (input['-n']) args.push('-n');

    args.push('--', input.pattern, searchPath);

    let stdout: string;
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

    const rows = parseRipgrepRows(stdout, mode);

    // The pre-call gate adjudicated the search root. It could not adjudicate
    // what the search found — and in content mode a hit carries the matched
    // line, so an unfiltered result set hands over the contents of a file the
    // contract says must not be read.
    //
    // A row with no path came from a single-file search, so the file it came
    // from is the search root. Attributing it there rather than skipping it
    // keeps the filter independent of the gate having got that call right.
    const { kept, withheld } = withholdDeniedReads(
      ctx.contract,
      ctx.cwd,
      rows,
      (row) => row.path ?? searchPath,
    );

    let lines = kept.map(formatRipgrepRow);
    const matched = lines.length;

    if (input.head_limit && input.head_limit > 0) {
      const truncated = lines.length > input.head_limit;
      lines = lines.slice(0, input.head_limit);
      if (truncated) lines.push(`... [${lines.length} of ${matched}]`);
    }

    // Say that something was withheld, never what. Silence is worse than the
    // count: an agent that finds nothing goes looking through Bash, which the
    // contract does not reach at all.
    const notice = withheldNotice(withheld);
    if (notice) lines.push(notice);

    return {
      content: lines.join('\n') || '(no matches)',
      data: { mode, matches: matched, ...(withheld > 0 ? { withheld } : {}) },
    };
  },
};
