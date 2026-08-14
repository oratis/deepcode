// Tool-output spill policy — the single place that bounds model-visible tool output.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.1
//
// Every tool result passes through here on its way to the model. Results at or
// under the threshold are returned untouched, so this is invisible for the
// overwhelming majority of calls. Oversized results are replaced by a head+tail
// preview naming where the full text went.
//
// The invariant worth stating: after this runs, no tool can put more than
// `thresholdChars` (plus a fixed-size marker) into the model's context. That is
// a stronger guarantee than each tool policing itself, which is what let
// WebFetch return a 5 MiB response body verbatim.

import type { ToolResult } from '../types.js';
import { boundText } from './bound.js';
import type { SpillSource, SpillStore } from './types.js';

/** Default model-visible ceiling, matching the cap Bash has always applied per stream. */
export const DEFAULT_SPILL_THRESHOLD_CHARS = 30_000;

/** Share of the preview budget given to the head; the rest goes to the tail. */
const HEAD_SHARE = 0.4;

export interface SpillPolicyOptions {
  /** Which call produced this result. */
  source: SpillSource;
  /** Where to persist oversized text. Omitted when the host cannot persist. */
  store?: SpillStore;
  /** Model-visible ceiling in code units. Defaults to {@link DEFAULT_SPILL_THRESHOLD_CHARS}. */
  thresholdChars?: number;
}

/** What the policy did, recorded on `ToolResult.data.spill` for the UI. */
export interface SpillOutcome {
  /** Code units in the original result content. */
  originalChars: number;
  /** Code units replaced by the marker. */
  omittedChars: number;
  /** Absent when the content could not be persisted. */
  locator?: string;
  /** Why persistence did not happen, when it did not. */
  unsavedReason?: string;
}

function marker(omitted: number, locator: string | undefined, hint: string | undefined): string {
  const omittedText = `${omitted.toLocaleString('en-US')} characters omitted`;
  if (locator === undefined) {
    return `\n\n... [${omittedText}. The full output was not saved — ${hint}. Re-run with a narrower scope (a filter, a smaller range, or head/tail) to see the middle.] ...\n\n`;
  }
  return `\n\n... [${omittedText}. Full output saved to:\n${locator}\n${hint}] ...\n\n`;
}

/**
 * Bound a tool result to the model-visible ceiling, persisting the full text
 * when a store is available.
 *
 * Persistence failures are not propagated: a result the model can read in part
 * beats an error, so a failed save degrades to the same preview with the reason
 * stated inline.
 *
 * @param result The tool's own result.
 * @param opts Source attribution, optional store, and threshold.
 * @returns The original result when it fits, otherwise a preview-bearing copy.
 */
export async function applySpillPolicy(
  result: ToolResult,
  opts: SpillPolicyOptions,
): Promise<ToolResult> {
  const threshold = opts.thresholdChars ?? DEFAULT_SPILL_THRESHOLD_CHARS;
  const content = result.content;
  if (content.length <= threshold) return result;

  const headChars = Math.floor(threshold * HEAD_SHARE);
  const { head, tail, omitted } = boundText(content, headChars, threshold - headChars);

  let locator: string | undefined;
  let hint = 'no session directory is available for this run';
  let unsavedReason: string | undefined = hint;
  if (opts.store) {
    try {
      const ref = await opts.store.saveText({ source: opts.source, content });
      locator = ref.locator;
      hint = ref.retrievalHint;
      unsavedReason = undefined;
    } catch (err) {
      hint = `saving it failed: ${(err as Error).message}`;
      unsavedReason = hint;
    }
  }

  const outcome: SpillOutcome = {
    originalChars: content.length,
    omittedChars: omitted,
    ...(locator !== undefined ? { locator } : {}),
    ...(unsavedReason !== undefined ? { unsavedReason } : {}),
  };

  return {
    ...result,
    content: head + marker(omitted, locator, hint) + tail,
    data: { ...result.data, spill: outcome },
  };
}
