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
 * Reduce `text` to at most `headChars` from the front and `tailChars` from the
 * back. Returns the whole string as `head` when it already fits.
 *
 * @param text Input string.
 * @param headChars Maximum code units to keep from the front (>= 0).
 * @param tailChars Maximum code units to keep from the back (>= 0).
 * @returns The two retained ends and the count dropped between them.
 */
export declare function boundText(text: string, headChars: number, tailChars: number): BoundedText;
/**
 * Streaming head+tail buffer, for output that arrives in chunks and whose total
 * size is not known in advance.
 *
 * Memory stays bounded at roughly `headChars + tailChars` code units no matter
 * how much is pushed through it — a command that prints gigabytes costs the same
 * as one that prints kilobytes.
 */
export declare class BoundedCapture {
    #private;
    private readonly headChars;
    private readonly tailChars;
    /**
     * @param headChars Maximum code units retained from the front.
     * @param tailChars Maximum code units retained from the back.
     */
    constructor(headChars: number, tailChars: number);
    /**
     * Append a chunk, discarding from the middle as needed.
     *
     * @param chunk Text to append.
     */
    push(chunk: string): void;
    /** Code units pushed in total, including those since discarded. */
    get total(): number;
    /** Code units discarded from the middle. */
    get omitted(): number;
    /**
     * The retained text. When nothing was discarded this is the exact input;
     * otherwise the two ends are joined by a marker naming the gap.
     *
     * @returns Retained text, with an inline marker when a gap exists.
     */
    text(): string;
}
//# sourceMappingURL=bound.d.ts.map