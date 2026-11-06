import type { ToolHandler } from '../types.js';
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
export declare function parseRipgrepRows(stdout: string, mode: GrepInput['output_mode']): RipgrepRow[];
/**
 * Undo `--null`, reproducing rg's default output byte for byte.
 *
 * The separator is written back only where rg wrote one. Give a single file as
 * the search path and rg prints `1:hit` with no filename at all — emitting
 * `path + ':' + text` there would prepend a colon to every line of a result set
 * that was previously correct.
 */
export declare function formatRipgrepRow(row: RipgrepRow): string;
export declare const GrepTool: ToolHandler;
export {};
//# sourceMappingURL=grep.d.ts.map