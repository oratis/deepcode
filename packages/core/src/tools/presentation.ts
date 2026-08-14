// How a tool call should be rendered — decided by the tool, not by the client.
//
// Spec: docs/DSH_ADOPTION_PLAN.md §1.6
//
// A tool knows what its call means; a client only knows a name and a JSON blob.
// Without this, every client re-derives the same knowledge — `name === 'Edit'`
// hardcoded in the desktop, again in the CLI, again in the VS Code extension —
// and the next tool has to be taught to all three.
//
// Presentation is a pure function of the call's ARGUMENTS. It never depends on
// the result, on the filesystem, or on anything that can differ between a live
// render and a replay from the session log, so a resumed session renders
// identically to the one that produced it.
//
// This module holds no UI types. `packages/core` has no UI dependency and does
// not gain one here: the intent is an enum and the payload is plain data.

/** How a client should present a call. */
export type ToolRenderKind =
  /** Name, target, and the result as text. The default. */
  | 'generic'
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

/** Argument keys that make a reasonable header label, most specific first. */
const TARGET_KEYS = ['file_path', 'command', 'pattern', 'path', 'url', 'query', 'notebook_path'];

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Pick a human-readable label for a call from its arguments.
 *
 * @param input The call's arguments.
 * @returns The label, or undefined when no argument makes a useful one.
 */
export function pickTarget(input: Record<string, unknown>): string | undefined {
  for (const key of TARGET_KEYS) {
    const v = str(input, key);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Render intents for the built-in tools, by name. */
export const BUILTIN_RENDER_INTENTS: Readonly<Record<string, ToolRenderKind>> = {
  Bash: 'terminal',
  Edit: 'diff',
  Write: 'diff',
  NotebookEdit: 'diff',
};

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
export function presentToolCall(
  name: string,
  input: Record<string, unknown>,
  declared: ToolRenderKind | undefined = BUILTIN_RENDER_INTENTS[name],
): ToolPresentation {
  const target = pickTarget(input);
  const kind = declared ?? 'generic';

  if (kind === 'terminal') {
    const command = str(input, 'command');
    return command === undefined ? { kind: 'generic', target } : { kind, target, command };
  }

  if (kind === 'diff') {
    const path = str(input, 'file_path') ?? str(input, 'notebook_path');
    if (path === undefined) return { kind: 'generic', target };
    // Edit states both sides. Write and NotebookEdit state only the new text —
    // the old side is on disk, which this function deliberately cannot read, so
    // the change renders as wholly added rather than as a lie about what it
    // replaced.
    const before = str(input, 'old_string') ?? '';
    const after = str(input, 'new_string') ?? str(input, 'content') ?? str(input, 'new_source');
    if (after === undefined) return { kind: 'generic', target };
    return { kind, target, diff: { path, before, after } };
  }

  return { kind: 'generic', target };
}
