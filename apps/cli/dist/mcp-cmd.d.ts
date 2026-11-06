import { type Mode, type SandboxMode, type ServeMcpStdioOpts } from '@deepcode/core';
import type { Writable } from 'node:stream';
export interface McpCmdDeps {
    cwd: string;
    /** Diagnostics sink — defaults to process.stderr (NEVER stdout in serve mode). */
    errOutput?: Writable;
    /** Help/normal output sink — defaults to process.stdout. */
    output?: Writable;
    /** Abort signal to stop the server (tests / SIGINT). */
    signal?: AbortSignal;
    /** Serve implementation — injectable so tests don't grab the real stdio. */
    serve?: (opts: ServeMcpStdioOpts) => Promise<void>;
    /** Override `~/.deepcode` (tests). */
    home?: string;
    /** `--mode`: the explicit opt-in out of the unattended clamp. */
    mode?: Mode;
    /** `--sandbox`: tightens the sandbox for served commands. */
    sandbox?: SandboxMode;
}
export declare function runMcpCommand(sub: string[], deps: McpCmdDeps): Promise<number>;
//# sourceMappingURL=mcp-cmd.d.ts.map