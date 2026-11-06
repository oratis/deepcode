import type { StatusLineConfig } from '../config/types.js';
export interface StatusLinePayload {
    session_id: string;
    model: string;
    cwd: string;
    mode: string;
    effort: string;
    transcript_path?: string;
    cost?: {
        yuan: number;
    };
    version: string;
    output_style?: string;
}
export interface StatusLineRunnerOpts {
    config: StatusLineConfig;
    /** Function the runner calls to get the latest payload. */
    payload: () => StatusLinePayload;
    /** Function the runner calls with new stdout text whenever it changes. */
    onUpdate: (text: string) => void;
    /** Refresh period in ms (default 5000). Read from
     *  DEEPCODE_STATUS_LINE_DEBOUNCE_MS env var if set. */
    debounceMs?: number;
}
export declare class StatusLineRunner {
    private readonly opts;
    private readonly debounceMs;
    private timer;
    private lastText;
    private running;
    constructor(opts: StatusLineRunnerOpts);
    start(): void;
    stop(): void;
    /** Force an immediate refresh (e.g. after the model changes). */
    refresh(): void;
    private tick;
}
/**
 * Execute the statusLine command with the JSON payload on stdin.
 * Returns the trimmed stdout. On failure returns an empty string.
 */
export declare function runStatusLineCommand(config: StatusLineConfig, stdinPayload: string): Promise<string>;
//# sourceMappingURL=statusline.d.ts.map