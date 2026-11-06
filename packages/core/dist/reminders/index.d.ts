export interface ReminderContext {
    /** Current working directory. */
    cwd: string;
    /** Optional session dir (where todos.json lives). */
    sessionDir?: string;
    /**
     * Files the agent has read or written in this session, with mtime at the
     * time of access. Used to detect external modifications between turns.
     */
    knownFiles?: Map<string, number>;
    /** Current agent mode — surfaced when 'plan'. */
    mode?: string;
    /**
     * Last time the user ran tests in this session (epoch ms). Stale-test
     * reminder fires when > 10min since last run AND at least one Edit/Write
     * has happened since then.
     */
    lastTestRunAt?: number;
    /** Whether any Edit/Write tool call has fired since lastTestRunAt. */
    editsSinceTests?: number;
    /** Override `now()` for tests. */
    now?: () => Date;
}
export interface ReminderOptions {
    /**
     * Which reminders to evaluate. If omitted, all builders run.
     * Useful for opt-out via settings.
     */
    enabled?: ReminderType[];
}
export type ReminderType = 'date' | 'cwd' | 'agents-md-missing' | 'todos-pending' | 'external-file-modified' | 'plan-mode-active' | 'no-test-yet';
/**
 * Build the composite system-reminder block. Returns null if no individual
 * reminder fires.
 */
export declare function buildSystemReminders(ctx: ReminderContext, opts?: ReminderOptions): Promise<string | null>;
export declare function dateReminder(ctx: ReminderContext): string;
export declare function cwdReminder(ctx: ReminderContext): string;
export declare function agentsMdMissingReminder(ctx: ReminderContext): Promise<string | null>;
export declare function todosPendingReminder(ctx: ReminderContext): Promise<string | null>;
export declare function externalFileModifiedReminder(ctx: ReminderContext): Promise<string | null>;
export declare function planModeActiveReminder(ctx: ReminderContext): string | null;
export declare function noTestYetReminder(ctx: ReminderContext): string | null;
/**
 * Convenience: format reminders to be appended to the front of the user
 * message text. Returns the original text unchanged if no reminders fire.
 */
export declare function prependReminders(userMessage: string, ctx: ReminderContext, opts?: ReminderOptions): Promise<string>;
//# sourceMappingURL=index.d.ts.map