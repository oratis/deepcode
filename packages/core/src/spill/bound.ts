// Head+tail bounding — the one primitive both the capture buffer and the
// model-visible preview are built from.
//
// Spec: docs/DSH_ADOPTION_PLAN.md §1.1
//
// Why head AND tail: a stack trace, an assertion diff, and a non-zero exit line
// all live at the END of a command's output, which is exactly what head-only
// truncation throws away. Keeping both ends costs nothing and is the difference
// between a usable excerpt and a useless one.
//
// Units are UTF-16 code units (JS string length), not bytes. Byte counts are
// reported only for content actually written to disk.

/** A string reduced to its two ends, plus how much was dropped between them. */
export interface BoundedText {
  /** The retained head. Empty when `headChars` is 0. */
  head: string;
  /** The retained tail. Empty when nothing was dropped (all of it is in `head`). */
  tail: string;
  /** Code units dropped between head and tail. 0 means `head + tail` is the whole input. */
  omitted: number;
}

/**
 * Trim a lone surrogate off the end of a slice, so cutting mid-pair can never
 * emit an unpaired code unit.
 */
function trimEnd(s: string): string {
  const last = s.charCodeAt(s.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? s.slice(0, -1) : s;
}

/** Trim a lone low surrogate off the start of a slice, for the same reason. */
function trimStart(s: string): string {
  const first = s.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? s.slice(1) : s;
}

/**
 * Reduce `text` to at most `headChars` from the front and `tailChars` from the
 * back. Returns the whole string as `head` when it already fits.
 *
 * @param text Input string.
 * @param headChars Maximum code units to keep from the front (>= 0).
 * @param tailChars Maximum code units to keep from the back (>= 0).
 * @returns The two retained ends and the count dropped between them.
 */
export function boundText(text: string, headChars: number, tailChars: number): BoundedText {
  if (text.length <= headChars + tailChars) return { head: text, tail: '', omitted: 0 };
  const head = trimEnd(text.slice(0, headChars));
  const tail = tailChars > 0 ? trimStart(text.slice(text.length - tailChars)) : '';
  return { head, tail, omitted: text.length - head.length - tail.length };
}

/**
 * Streaming head+tail buffer, for output that arrives in chunks and whose total
 * size is not known in advance.
 *
 * Memory stays bounded at roughly `headChars + tailChars` code units no matter
 * how much is pushed through it — a command that prints gigabytes costs the same
 * as one that prints kilobytes.
 */
export class BoundedCapture {
  #head = '';
  #tail = '';
  #total = 0;

  /**
   * @param headChars Maximum code units retained from the front.
   * @param tailChars Maximum code units retained from the back.
   */
  constructor(
    private readonly headChars: number,
    private readonly tailChars: number,
  ) {}

  /**
   * Append a chunk, discarding from the middle as needed.
   *
   * @param chunk Text to append.
   */
  push(chunk: string): void {
    this.#total += chunk.length;
    let rest = chunk;
    if (this.#head.length < this.headChars) {
      const room = this.headChars - this.#head.length;
      this.#head += rest.slice(0, room);
      rest = rest.slice(room);
    }
    if (rest.length === 0) return;
    const merged = this.#tail + rest;
    this.#tail =
      merged.length > this.tailChars ? merged.slice(merged.length - this.tailChars) : merged;
  }

  /** Code units pushed in total, including those since discarded. */
  get total(): number {
    return this.#total;
  }

  /** Code units discarded from the middle. */
  get omitted(): number {
    return this.#total - this.#head.length - this.#tail.length;
  }

  /**
   * The retained text. When nothing was discarded this is the exact input;
   * otherwise the two ends are joined by a marker naming the gap.
   *
   * @returns Retained text, with an inline marker when a gap exists.
   */
  text(): string {
    const gap = this.omitted;
    if (gap <= 0) return this.#head + this.#tail;
    return `${trimEnd(this.#head)}\n... [${gap.toLocaleString('en-US')} characters not captured — output exceeded the capture limit] ...\n${trimStart(this.#tail)}`;
  }
}
