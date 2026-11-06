import type { SandboxConfig, SandboxMode } from '../config/types.js';
/** Result of one command run in a persistent shell. */
export interface ShellRunResult {
    /** Everything the command wrote, stdout and stderr interleaved. */
    output: string;
    /** Exit status, or null when the command did not finish. */
    exitCode: number | null;
    /** True when the deadline elapsed before the command finished. */
    timedOut: boolean;
    /**
     * True when the shell could not be recovered and has been discarded. The
     * caller must open a new one; this session's id is dead.
     */
    discarded: boolean;
}
export interface ShellSessionOptions {
    /** Directory the shell starts in. */
    cwd: string;
    /** Sandbox configuration, applied once when the shell starts. */
    sandboxConfig?: SandboxConfig;
    /** Sandbox mode when the config names none. */
    sandboxDefaultMode?: SandboxMode;
    /** Environment for the shell process. Defaults to the parent's. */
    env?: NodeJS.ProcessEnv;
}
/**
 * A long-lived shell process, one command at a time.
 *
 * The shell keeps its working directory, environment, functions, and any
 * background jobs across calls, which is the entire point.
 */
export declare class PersistentShell {
    #private;
    private constructor();
    /**
     * Start a shell.
     *
     * The sandbox wrapper is resolved once, here. A later change to sandbox
     * settings does not re-arm a shell that is already running — the tool
     * description states this, and it is why the policy is captured at open time
     * rather than read per command.
     *
     * @param opts Where to start and under what confinement.
     * @returns A ready session.
     */
    static open(opts: ShellSessionOptions): Promise<PersistentShell>;
    /** Directory the shell was started in. Its current one may differ after `cd`. */
    get cwd(): string;
    /** True once the shell has exited or been closed. */
    get closed(): boolean;
    /** True while a command is running. */
    get busy(): boolean;
    /**
     * Run one command and wait for it to finish.
     *
     * @param command Shell source to run. Multi-line is fine.
     * @param timeoutMs How long to wait before interrupting it.
     * @returns Its output and exit status, or what is known if it timed out.
     */
    run(command: string, timeoutMs: number): Promise<ShellRunResult>;
    /** Stop the shell and everything it started. */
    close(): Promise<void>;
}
//# sourceMappingURL=session.d.ts.map