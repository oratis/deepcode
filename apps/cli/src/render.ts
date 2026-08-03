// Terminal rendering for the REPL.
//
// Everything here is a pure string -> string function so it can be tested
// without a TTY. The REPL owns the writing; this module owns what the bytes
// look like. Colour is resolved once at startup and threaded through as a
// palette, so a non-TTY / NO_COLOR run produces byte-identical text minus the
// escape codes.

import { computeLineDiff, type DiffLine } from '@deepcode/core';

// ── colour ──────────────────────────────────────────────────────────────────

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

const wrap =
  (open: string): Paint =>
  (s) =>
    `\u001b[${open}m${s}\u001b[0m`;
const plain: Paint = (s) => s;

export function makePalette(enabled: boolean): Palette {
  if (!enabled) {
    return {
      enabled,
      dim: plain,
      bold: plain,
      red: plain,
      green: plain,
      yellow: plain,
      cyan: plain,
    };
  }
  return {
    enabled,
    dim: wrap('2'),
    bold: wrap('1'),
    red: wrap('31'),
    green: wrap('32'),
    yellow: wrap('33'),
    cyan: wrap('36'),
  };
}

/**
 * Standard precedence: NO_COLOR beats everything (any value, per no-color.org),
 * then FORCE_COLOR, then TERM=dumb, then whether we're actually on a terminal.
 */
export function colorEnabled(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== 'false';
  if (env.TERM === 'dumb') return false;
  return isTTY;
}

// ── diffs ───────────────────────────────────────────────────────────────────

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
export function renderDiff(
  oldText: string,
  newText: string,
  palette: Palette,
  options: DiffRenderOptions = {},
): string {
  const context = options.context ?? 2;
  const maxLines = options.maxLines ?? 40;
  const indent = options.indent ?? '    ';

  const lines = computeLineDiff(oldText, newText);
  const keep = keptIndices(lines, context);
  if (keep.size === 0) return `${indent}${palette.dim('(no change)')}\n`;

  const out: string[] = [];
  let emitted = 0;
  let elided = 0;
  let gap = false;

  for (let i = 0; i < lines.length; i++) {
    if (!keep.has(i)) {
      gap = true;
      continue;
    }
    if (emitted >= maxLines) {
      if (lines[i]!.kind !== 'ctx') elided++;
      continue;
    }
    // Also marks a leading gap, so a diff that starts at line 400 doesn't look
    // like it starts at the top of the file.
    if (gap) out.push(`${indent}${palette.dim('  ⋯')}`);
    gap = false;
    out.push(indent + paintDiffLine(lines[i]!, palette));
    emitted++;
  }

  if (elided > 0) {
    out.push(
      `${indent}${palette.dim(`  ⋯ ${elided} more changed line${elided === 1 ? '' : 's'}`)}`,
    );
  }
  return out.join('\n') + '\n';
}

function paintDiffLine(line: DiffLine, palette: Palette): string {
  const no = String(line.newNo ?? line.oldNo ?? '').padStart(4, ' ');
  if (line.kind === 'add') return palette.green(`${no} + ${line.text}`);
  if (line.kind === 'del') return palette.red(`${no} - ${line.text}`);
  return palette.dim(`${no}   ${line.text}`);
}

/** Indices worth printing: every change, plus `context` rows around each. */
function keptIndices(lines: DiffLine[], context: number): Set<number> {
  const keep = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.kind === 'ctx') continue;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
      keep.add(j);
    }
  }
  return keep;
}

// ── tool calls ──────────────────────────────────────────────────────────────

/** The one-line target shown next to a tool name. */
export function toolTarget(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'command', 'pattern', 'path', 'url', 'query']) {
    const v = input[key];
    if (typeof v === 'string') return v.split('\n')[0]!;
  }
  return JSON.stringify(input).slice(0, 80);
}

export function renderToolCall(
  name: string,
  input: Record<string, unknown>,
  palette: Palette,
): string {
  return `\n  ${palette.cyan('●')} ${palette.bold(name)}  ${palette.dim(toolTarget(input))}\n`;
}

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
export function renderToolResult(
  content: string,
  isError: boolean,
  palette: Palette,
  options: ResultRenderOptions = {},
): string {
  const head = options.head ?? 12;
  const tail = options.tail ?? 4;
  const maxLineWidth = options.maxLineWidth ?? 400;

  const mark = isError ? palette.red('✕') : palette.green('✓');
  // Failing output stays at full brightness so it is readable; success output
  // recedes. Exactly one paint per line — nesting produces unreadable byte soup
  // (`ESC[31m ESC[2m … ESC[0m ESC[0m`) and doubles the output size.
  const paint: Paint = isError ? (l) => l : palette.dim;
  const all = content.replace(/\n+$/, '').split('\n');
  if (content.trim() === '') return `    ${mark} ${palette.dim('(no output)')}\n`;

  const clip = (s: string): string =>
    s.length > maxLineWidth ? s.slice(0, maxLineWidth) + ' …' : s;

  const shown: string[] =
    all.length <= head + tail + 1
      ? all.map(clip)
      : [
          ...all.slice(0, head).map(clip),
          `… ${all.length - head - tail} lines elided …`,
          ...all.slice(-tail).map(clip),
        ];

  return (
    shown.map((l, i) => (i === 0 ? `    ${mark} ${paint(l)}` : `      ${paint(l)}`)).join('\n') +
    '\n'
  );
}

// ── approval previews ───────────────────────────────────────────────────────

/**
 * What the user is actually being asked to approve. Returning the change itself
 * — rather than just a tool name — is the difference between an informed yes
 * and a reflexive one.
 *
 * `existing` is the current file content, when the caller could read it; it
 * turns a Write into a real before/after instead of a wall of additions.
 */
export function renderApprovalPreview(
  toolName: string,
  input: Record<string, unknown>,
  palette: Palette,
  existing?: string,
): string {
  const str = (key: string): string | undefined =>
    typeof input[key] === 'string' ? (input[key] as string) : undefined;

  if (toolName === 'Edit') {
    const oldStr = str('old_string');
    const newStr = str('new_string');
    if (oldStr !== undefined && newStr !== undefined) {
      return renderDiff(oldStr, newStr, palette);
    }
  }

  if (toolName === 'Write') {
    const content = str('content');
    if (content !== undefined) return renderDiff(existing ?? '', content, palette);
  }

  if (toolName === 'Bash') {
    const command = str('command');
    if (command !== undefined) {
      const body = command
        .split('\n')
        .map((l) => `    ${palette.yellow(l)}`)
        .join('\n');
      const description = str('description');
      return description ? `    ${palette.dim(description)}\n${body}\n` : `${body}\n`;
    }
  }

  const json = JSON.stringify(input, null, 2) ?? '';
  const lines = json.split('\n');
  const shown =
    lines.length > 20 ? [...lines.slice(0, 20), `… ${lines.length - 20} more lines`] : lines;
  return shown.map((l) => `    ${palette.dim(l)}`).join('\n') + '\n';
}

// ── reasoning ───────────────────────────────────────────────────────────────

/**
 * Streams the model's reasoning as a dim, gutter-marked side channel so it is
 * visibly not the answer. Stateful because deltas arrive mid-line: it tracks
 * whether a gutter marker is still owed for the current line.
 *
 * DeepSeek's reasoner is the point of this product; dropping its reasoning on
 * the floor (which is what the REPL did) hid the most useful thing it emits.
 */
export class ThinkingStream {
  private open = false;
  private atLineStart = true;

  constructor(
    private readonly palette: Palette,
    private readonly gutter = '  ┆ ',
  ) {}

  /**
   * Text to write for a reasoning delta.
   *
   * Painted per line segment, not per character: deltas arrive a few tokens at
   * a time, and wrapping every character in its own escape pair turns a
   * paragraph of reasoning into kilobytes of terminal soup.
   */
  delta(text: string): string {
    let out = '';
    if (!this.open) {
      out += `\n  ${this.palette.dim('┆ thinking')}\n`;
      this.open = true;
      this.atLineStart = true;
    }
    const segments = text.split('\n');
    for (let i = 0; i < segments.length; i++) {
      if (i > 0) {
        out += '\n';
        this.atLineStart = true;
      }
      const segment = segments[i]!;
      if (segment === '') continue;
      if (this.atLineStart) {
        out += this.palette.dim(this.gutter);
        this.atLineStart = false;
      }
      out += this.palette.dim(segment);
    }
    return out;
  }

  /** Close the reasoning block before non-reasoning output. */
  close(): string {
    if (!this.open) return '';
    this.open = false;
    const trailingNewline = this.atLineStart ? '' : '\n';
    this.atLineStart = true;
    return `${trailingNewline}\n`;
  }

  get isOpen(): boolean {
    return this.open;
  }
}
