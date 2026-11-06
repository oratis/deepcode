/** How a client should present a call. */
export type ToolRenderKind = 
/** Name, target, and the result as text. The default. */
'generic'
/** A shell command and its output. */
 | 'terminal'
/** A change to a file, shown as added and removed lines. */
 | 'diff';
/** A file change derivable from a call's arguments alone. */
export interface ToolDiffIntent {
    /** Path as the call named it — not resolved, so this stays pure. */
    path: string;
    /** Text being replaced. Empty when the call creates content wholesale. */
    before: string;
    /** Text replacing it. */
    after: string;
}
/** Everything a client needs to render one call, derived from its arguments. */
export interface ToolPresentation {
    kind: ToolRenderKind;
    /** Header label: the file, command, or pattern this call is about. */
    target?: string;
    /** For `terminal`: the command line, so a client can show it as a prompt. */
    command?: string;
    /** For `diff`: the change itself. */
    diff?: ToolDiffIntent;
}
/**
 * Pick a human-readable label for a call from its arguments.
 *
 * @param input The call's arguments.
 * @returns The label, or undefined when no argument makes a useful one.
 */
export declare function pickTarget(input: Record<string, unknown>): string | undefined;
/** Render intents for the built-in tools, by name. */
export declare const BUILTIN_RENDER_INTENTS: Readonly<Record<string, ToolRenderKind>>;
/**
 * Derive how to render one tool call.
 *
 * The declared `kind` is a request, not a guarantee: a call that declares `diff`
 * but carries no usable path or text falls back to `generic` rather than
 * handing the client an empty diff to render.
 *
 * @param name Tool name.
 * @param input The call's arguments.
 * @param declared The tool's declared render intent. Defaults to the built-in
 *   table, so a client holding only a name and arguments — a renderer replaying
 *   a session log, say — needs no access to the tool definition.
 * @returns A presentation the client can render without knowing the tool.
 */
export declare function presentToolCall(name: string, input: Record<string, unknown>, declared?: ToolRenderKind | undefined): ToolPresentation;
//# sourceMappingURL=presentation.d.ts.map