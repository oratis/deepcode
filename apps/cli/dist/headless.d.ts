import { type SandboxMode, type Effort, type PermissionRules, type UnattendedApprovalPolicy } from '@deepcode/core';
import type { Writable } from 'node:stream';
export interface HeadlessOpts {
    output: Writable;
    errOutput: Writable;
    cwd: string;
    home?: string;
    /** The prompt to run. */
    prompt: string;
    /** text | json | stream-json (cli default 'text'). */
    outputFormat: 'text' | 'json' | 'stream-json';
    /** `--sandbox <mode>` → overrides settings.sandbox.mode for this run. */
    sandbox?: SandboxMode;
    mode?: string;
    model?: string;
    effort?: Effort;
    systemPromptOverride?: string;
    appendSystemPrompt?: string;
    appendSystemPromptFile?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    maxTurns?: number;
    /** `--settings <file>` → a settings file that wins over discovered layers. */
    settingsPath?: string;
    /** Path to a JSON schema file. Final output (text in `text` mode, JSON
     *  object in `json` mode) is validated against it; mismatch → exit 1. */
    jsonSchema?: string;
    /** In stream-json mode, also emit text_delta and thinking_delta events.
     *  Default is to drop those for compact streams. */
    includePartialMessages?: boolean;
    /**
     * What to do when a call needs approval and nobody is there to give it.
     * `deny` (default) refuses that call and keeps going; `abort` ends the run
     * with exit code 6, which scheduled jobs generally want — a job that got
     * half its tool calls refused has usually produced a misleading result.
     */
    onApprovalRequired?: UnattendedApprovalPolicy;
    /**
     * Extra permission rules for this run, applied so they can only tighten the
     * ones loaded from settings. Used by the scheduler to give a job its own
     * bounded posture.
     */
    permissionsOverride?: PermissionRules;
    /**
     * Suppress the inherited-permissive-mode warning because the caller already
     * resolved the mode deliberately (and says so in its own log).
     */
    modeResolvedByCaller?: boolean;
}
export declare function runHeadless(opts: HeadlessOpts): Promise<number>;
//# sourceMappingURL=headless.d.ts.map