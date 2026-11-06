import type { Writable } from 'node:stream';
export type CompletionShell = 'bash' | 'zsh' | 'fish';
export declare const COMPLETION_SHELLS: CompletionShell[];
export declare function isCompletionShell(value: string | undefined): value is CompletionShell;
/** Return the completion script for `shell`. */
export declare function completionScript(shell: CompletionShell): string;
/** `deepcode completion <shell>` handler. Returns the process exit code. */
export declare function runCompletion(args: string[], io: {
    output: Writable;
    errOutput: Writable;
}): number;
//# sourceMappingURL=completion.d.ts.map