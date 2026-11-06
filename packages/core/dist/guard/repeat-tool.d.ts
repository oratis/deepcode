/** Reminder escalation, chosen by which threshold the run length reached. */
export type RepeatReminderKind = 'brief' | 'detailed';
export interface RepeatGuardOptions {
    /**
     * Consecutive-run lengths that produce a reminder, ascending. The first is a
     * brief nudge; every later one is detailed.
     */
    thresholds?: number[];
    /**
     * Tools transparent to the chain — they neither extend a run nor reset it.
     * This is what stops bookkeeping calls from laundering a loop: with
     * `TodoWrite` excluded, `Grep X → TodoWrite → Grep X` is still two
     * consecutive `Grep X`.
     */
    exclude?: string[];
    /** Cap on argument text quoted in a detailed reminder. */
    argumentsPreviewChars?: number;
}
/** Bookkeeping tools, and the one tool whose repetition means "still waiting". */
export declare const DEFAULT_REPEAT_EXCLUDE: string[];
/** One fired reminder: what to tell the model, and what tripped it. */
export interface RepeatReminder {
    kind: RepeatReminderKind;
    toolName: string;
    /** Length of the consecutive run that tripped this threshold. */
    runLength: number;
    /** Text to put in front of the model. */
    text: string;
}
/**
 * Tracks one agent's chain of consecutive identical tool calls.
 *
 * State is in memory and per-run by design: a resumed session starts a fresh
 * chain. This is a heuristic nudge, not a logged invariant, and re-counting
 * after a resume is cheaper than persisting it.
 */
export declare class RepeatToolGuard {
    #private;
    /**
     * @param opts Thresholds, exclusions, and the argument preview cap.
     */
    constructor(opts?: RepeatGuardOptions);
    /**
     * Record a tool call and report whether it tripped a threshold.
     *
     * Call this for every call the model issued, including ones the gate refused:
     * a model hammering a denied call is exactly the loop worth interrupting.
     *
     * @param toolName Name of the tool called.
     * @param input The call's arguments.
     * @returns A reminder when this call reached a configured run length, else null.
     */
    observe(toolName: string, input: Record<string, unknown>): RepeatReminder | null;
    /** Reset the chain — used when a new user message starts a fresh line of work. */
    reset(): void;
}
//# sourceMappingURL=repeat-tool.d.ts.map