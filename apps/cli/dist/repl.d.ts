import { SessionManager, type SandboxMode, type Effort, type SessionMeta, type StoredMessage } from '@deepcode/core';
import type { Readable, Writable } from 'node:stream';
export interface ReplOpts {
    input: Readable;
    output: Writable;
    cwd: string;
    /** Override $HOME for tests. */
    home?: string;
    /** Initial mode (overrides settings). */
    mode?: string;
    /** Initial model (overrides settings). */
    model?: string;
    /** Initial effort (overrides settings). */
    effort?: Effort;
    /** Replace the default system prompt entirely. */
    systemPromptOverride?: string;
    /** Append text to the system prompt. */
    appendSystemPrompt?: string;
    /** Path to a file whose contents are appended to system prompt. */
    appendSystemPromptFile?: string;
    /** Whitelist of tool names — only these are loaded. */
    allowedTools?: string[];
    /** Blacklist of tool names — these are removed. */
    disallowedTools?: string[];
    /** Cap on agent loop turns. */
    maxTurns?: number;
    /** `--resume` with no id → pick a session interactively. */
    resume?: boolean;
    /** `--resume <id>` → resume this specific session (append to it). */
    resumeId?: string;
    /** `--continue` → resume the most recently updated session in this cwd. */
    continueSession?: boolean;
    /** `--fork-session` → resume into a NEW session, leaving the source intact. */
    forkSession?: boolean;
    /** `--bare` → suppress the startup banner (scripting / minimal output). */
    bare?: boolean;
    /** `--no-plugins` → skip discovering + wiring installed plugins. */
    noPlugins?: boolean;
    /** `--settings <file>` → a settings file that wins over discovered layers. */
    settingsPath?: string;
    /** `--no-color` → force plain output even on a TTY (NO_COLOR is honoured too). */
    noColor?: boolean;
    /** `--no-thinking` → don't stream the model's reasoning. */
    hideThinking?: boolean;
    /** `--sandbox <mode>` → overrides settings.sandbox.mode for this run. */
    sandbox?: SandboxMode;
}
export interface SessionResolution {
    session: SessionMeta;
    /** Prior messages to seed into the agent's context (empty for a fresh session). */
    seededHistory: StoredMessage[];
    /** One-line status to print (resumed / forked / fell back to fresh). */
    notice?: string;
}
/**
 * Decide which session a REPL launch should use:
 *   - `resumeId`        → resume that exact session (append to it)
 *   - `continueSession` → resume the most-recently-updated session in `cwd`
 *   - `forkSession`     → resume into a NEW session seeded with a copy of the
 *                         source history, leaving the original untouched
 *   - otherwise         → a fresh session
 * Pure over a `SessionManager`, so it's unit-testable without a live REPL.
 */
export declare function resolveSession(sessions: SessionManager, cwd: string, model: string, opts: {
    resumeId?: string;
    continueSession?: boolean;
    forkSession?: boolean;
}): Promise<SessionResolution>;
/**
 * Run the interactive REPL.
 *
 * The persistent-shell registry is owned here, one per REPL session, so a shell
 * the agent opens in one turn is still there in the next — which is the whole
 * point of a shell that keeps its working directory. The wrapper closes every
 * one of them on the way out, including when the session throws: these are real
 * OS processes in their own process group, so they do not die with the CLI and
 * "the loop will remember" is not a guarantee.
 *
 * @param opts REPL configuration.
 * @returns Process exit code.
 */
export declare function startRepl(opts: ReplOpts): Promise<number>;
/**
 * Find the bundled built-in skills directory.
 * In dev: <repo>/packages/core/skills/.
 * In published package: packaged inside @deepcode/core/skills/.
 * Returns undefined if not found.
 */
//# sourceMappingURL=repl.d.ts.map