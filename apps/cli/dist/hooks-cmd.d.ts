import type { Writable } from 'node:stream';
export declare function runHooksCommand(args: string[], deps: {
    cwd: string;
    home?: string;
    output?: Writable;
    errOutput?: Writable;
}): Promise<number>;
//# sourceMappingURL=hooks-cmd.d.ts.map