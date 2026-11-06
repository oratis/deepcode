import { type ApplyConfirm } from '@deepcode/core';
import type { Readable, Writable } from 'node:stream';
export interface LedgerCmdDeps {
    cwd: string;
    home?: string;
    output?: Writable;
    errOutput?: Writable;
    json?: boolean;
    /** Where sessions (and therefore snapshots) live; overridden in tests. */
    sessionsRoot?: string;
    /** Input for the rollback confirmation prompt. */
    input?: Readable;
    /**
     * Substitute confirmation. Tests supply one; there is no default that says
     * yes, because a No Silent Apply with an implicit yes is not one.
     */
    confirm?: ApplyConfirm;
}
export declare function runLedgerCommand(args: string[], deps: LedgerCmdDeps): Promise<number>;
//# sourceMappingURL=ledger-cmd.d.ts.map