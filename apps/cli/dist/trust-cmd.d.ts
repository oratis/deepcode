import type { Writable } from 'node:stream';
export interface TrustCmdDeps {
    cwd: string;
    home?: string;
    output?: Writable;
}
export declare function runTrustCommand(args: string[], deps: TrustCmdDeps): Promise<number>;
//# sourceMappingURL=trust-cmd.d.ts.map