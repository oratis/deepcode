export type Paint = (s: string) => string;
export interface Palette {
    readonly enabled: boolean;
    dim: Paint;
    bold: Paint;
    red: Paint;
    green: Paint;
    yellow: Paint;
    cyan: Paint;
}
export declare function makePalette(enabled: boolean): Palette;
/**
 * Standard precedence: NO_COLOR beats everything (any value, per no-color.org),
 * then FORCE_COLOR, then TERM=dumb, then whether we're actually on a terminal.
 */
export declare function colorEnabled(env: NodeJS.ProcessEnv, isTTY: boolean): boolean;
export interface DiffRenderOptions {
    /** Unchanged lines kept either side of a change. */
    context?: number;
    /** Hard cap on emitted diff rows; the rest is summarised in a footer. */
    maxLines?: number;
    /** Left margin applied to every line. */
    indent?: string;
}
/**
 * A unified diff, hunked and capped. Long stretches of unchanged code collapse
 * to a `⋯` marker so a two-line edit in a 900-line file prints as two lines.
 */
export declare function renderDiff(oldText: string, newText: string, palette: Palette, options?: DiffRenderOptions): string;
/** The one-line target shown next to a tool name. */
export declare function toolTarget(input: Record<string, unknown>): string;
export declare function renderToolCall(name: string, input: Record<string, unknown>, palette: Palette): string;
export interface ResultRenderOptions {
    /** Lines kept from the top of the output. */
    head?: number;
    /** Lines kept from the bottom. */
    tail?: number;
    /** Any single line longer than this is cut (minified JSON, base64, ...). */
    maxLineWidth?: number;
}
/**
 * Tool output, elided in the middle rather than cut off at a byte count — the
 * tail of a failing command is usually the part that matters.
 */
export declare function renderToolResult(content: string, isError: boolean, palette: Palette, options?: ResultRenderOptions): string;
/**
 * What the user is actually being asked to approve. Returning the change itself
 * — rather than just a tool name — is the difference between an informed yes
 * and a reflexive one.
 *
 * `existing` is the current file content, when the caller could read it; it
 * turns a Write into a real before/after instead of a wall of additions.
 */
export declare function renderApprovalPreview(toolName: string, input: Record<string, unknown>, palette: Palette, existing?: string): string;
/**
 * Streams the model's reasoning as a dim, gutter-marked side channel so it is
 * visibly not the answer. Stateful because deltas arrive mid-line: it tracks
 * whether a gutter marker is still owed for the current line.
 *
 * DeepSeek's reasoner is the point of this product; dropping its reasoning on
 * the floor (which is what the REPL did) hid the most useful thing it emits.
 */
export declare class ThinkingStream {
    private readonly palette;
    private readonly gutter;
    private open;
    private atLineStart;
    constructor(palette: Palette, gutter?: string);
    /**
     * Text to write for a reasoning delta.
     *
     * Painted per line segment, not per character: deltas arrive a few tokens at
     * a time, and wrapping every character in its own escape pair turns a
     * paragraph of reasoning into kilobytes of terminal soup.
     */
    delta(text: string): string;
    /** Close the reasoning block before non-reasoning output. */
    close(): string;
    get isOpen(): boolean;
}
//# sourceMappingURL=render.d.ts.map