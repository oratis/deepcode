import type { Writable } from 'node:stream';
export interface ContractCmdDeps {
    cwd: string;
    home?: string;
    output?: Writable;
    errOutput?: Writable;
}
export declare function runContractCommand(args: string[], deps: ContractCmdDeps): Promise<number>;
//# sourceMappingURL=contract-cmd.d.ts.map