// Tool-card bodies, one per render intent.
//
// Which body a call gets is decided in core (`tools/presentation.ts`), not here.
// This module only knows how to draw the three shapes — the mapping from tool to
// shape is the tool's own declaration, so adding a tool does not mean editing
// this file, the CLI, and the extension.

import type { JSX } from 'react';
import { computeLineDiff } from '../lib/diff.js';
import type { ToolLocation, ToolPresentation } from '@deepcode/core/dist/tools/presentation.js';

/** How much of a tool's text output a card shows before cutting it off. */
const MAX_BODY_CHARS = 1500;

function clip(text: string): string {
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n…` : text;
}

/**
 * A change as added and removed lines.
 *
 * A `Write` (or a `NotebookEdit`) states only the new text, so `before` is
 * empty and every line reads as an addition. That is accurate: the tool's
 * arguments genuinely do not say what was there before.
 */
function DiffBody({ before, after }: { before: string; after: string }): JSX.Element {
  const lines = computeLineDiff(before, after);
  return (
    <>
      {lines.map((line, i) => (
        <div
          key={i}
          className={
            line.kind === 'add' ? 'diff-add' : line.kind === 'del' ? 'diff-del' : undefined
          }
        >
          {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
          {line.text}
        </div>
      ))}
    </>
  );
}

/**
 * The places a search found, each one openable.
 *
 * Entries come from the tool's structured result data, resolved by the tool
 * itself from its own parsed rows — never re-parsed out of the formatted text,
 * whose `:` separator is ambiguous when a path contains one. Without an
 * `onOpenFile` the list still renders; the rows are just not buttons.
 */
function LocationsBody({
  locations,
  onOpenFile,
}: {
  locations: ToolLocation[];
  onOpenFile?: (path: string) => void;
}): JSX.Element {
  return (
    <>
      {locations.map((loc, i) => {
        const label = `${loc.display ?? loc.path}${loc.line !== undefined ? `:${loc.line}` : ''}`;
        return (
          <div key={i} className="tc-loc-row">
            {onOpenFile ? (
              <button type="button" className="tc-loc" onClick={() => onOpenFile(loc.path)}>
                {label}
              </button>
            ) : (
              <span className="tc-loc">{label}</span>
            )}
            {loc.preview !== undefined && loc.preview !== '' && (
              <span className="tc-loc-preview"> {loc.preview}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

/** A command and what it printed, styled as a shell transcript. */
function TerminalBody({ command, output }: { command: string; output?: string }): JSX.Element {
  return (
    <>
      <div className="tc-prompt">
        <span className="tc-sigil">$</span> {command}
      </div>
      {output ? <div className="tc-stream">{clip(output)}</div> : null}
    </>
  );
}

/**
 * Render a tool call's body according to the intent its tool declared.
 *
 * @param presentation What core derived from the call's arguments.
 * @param resultText The tool's output, once it has any.
 * @param locations Openable entries from the result's structured data. A call
 *   whose intent is `locations` but that has none — still running, restored
 *   from a session log, or genuinely empty — falls back to the text body.
 * @param onOpenFile Opens a path in the file panel, when the host offers one.
 * @returns The body, or null when there is nothing to show yet.
 */
export function ToolBody({
  presentation,
  resultText,
  locations,
  onOpenFile,
}: {
  presentation: ToolPresentation;
  resultText?: string;
  locations?: ToolLocation[];
  onOpenFile?: (path: string) => void;
}): JSX.Element | null {
  if (presentation.kind === 'diff' && presentation.diff) {
    return <DiffBody before={presentation.diff.before} after={presentation.diff.after} />;
  }
  if (presentation.kind === 'terminal' && presentation.command !== undefined) {
    return <TerminalBody command={presentation.command} output={resultText} />;
  }
  if (presentation.kind === 'locations' && locations && locations.length > 0) {
    return <LocationsBody locations={locations} onOpenFile={onOpenFile} />;
  }
  return resultText ? <>{clip(resultText)}</> : null;
}
