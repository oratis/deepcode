import type { Writable } from 'node:stream';
export interface DiagnosticsCommandOptions {
    cwd: string;
    home: string;
    output: Writable;
    errOutput: Writable;
}
export declare function runDiagnosticsCommand(args: string[], options: DiagnosticsCommandOptions): Promise<number>;
//# sourceMappingURL=diagnostics-cmd.d.ts.map