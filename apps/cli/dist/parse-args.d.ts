import type { Effort, Mode, SandboxMode } from '@deepcode/core';
export interface ParsedArgs {
    showHelp: boolean;
    showVersion: boolean;
    doctor: boolean;
    upgrade: boolean;
    prompt?: string;
    resume: boolean;
    resumeId?: string;
    continue: boolean;
    forkSession: boolean;
    mode?: Mode;
    model?: string;
    effort?: Effort;
    maxTurns?: number;
    bare: boolean;
    /**
     * `--sandbox <mode>` — what a command may touch. Orthogonal to `--mode`,
     * which is about how a tool call gets approved.
     */
    sandbox?: SandboxMode;
    /** `-C` / `--cd <dir>`: chdir to this directory before running (Codex parity). */
    cwd?: string;
    systemPrompt?: string;
    appendSystemPrompt?: string;
    appendSystemPromptFile?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    outputFormat: 'text' | 'json' | 'stream-json';
    jsonSchema?: string;
    includePartialMessages: boolean;
    verbose: boolean;
    /** `--json` — machine-readable output for subcommands (plugins/skills list). */
    json: boolean;
    /** `--no-color` — never emit ANSI escapes (NO_COLOR / a non-TTY do this too). */
    noColor: boolean;
    /** `--no-thinking` — don't stream the model's reasoning in the REPL. */
    noThinking: boolean;
    settingsFile?: string;
    agentsDir?: string;
    mcpConfig?: string;
    pluginDir?: string;
    pluginUrl?: string;
    noPlugins: boolean;
    strict: boolean;
    unknownFlags: string[];
    /**
     * Flags that parse but have no consumer yet. They are accepted (so existing
     * scripts keep running) and reported once at startup, rather than silently
     * doing nothing — which is how `--permission-mode` shipped broken for months.
     * Not listed in `--help`: `--help` documents what works.
     */
    unimplementedFlags: string[];
    positional: string[];
}
/**
 * Resolve the effective effort level from all precedence layers.
 * Order (high → low): cli flag → DEEPCODE_EFFORT_LEVEL env → settings → default.
 * Spec: docs/DEVELOPMENT_PLAN.md §3.13c.
 *
 * Returns `'medium'` if nothing produces a valid value.
 */
export declare function resolveEffort(args: {
    cliFlag?: string;
    envVar?: string;
    settingsLevel?: string;
}): Effort;
export declare function parseArgs(argv: string[]): ParsedArgs;
export declare function helpText(version: string): string;
//# sourceMappingURL=parse-args.d.ts.map