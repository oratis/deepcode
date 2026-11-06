import type { Readable } from 'node:stream';
import type { Writable } from 'node:stream';
export interface SetupTokenDeps {
    /** Token from the CLI argument, if any. */
    token?: string;
    home?: string;
    output?: Writable;
    errOutput?: Writable;
    /** Stdin to read a piped token from (non-TTY only). Defaults to process.stdin. */
    stdin?: Readable & {
        isTTY?: boolean;
    };
    /** Env lookup (injectable for tests). Defaults to process.env. */
    env?: NodeJS.ProcessEnv;
    /** Bypass the macOS Keychain and write the chmod-600 file (tests). */
    forceFile?: boolean;
}
export declare function runSetupToken(deps?: SetupTokenDeps): Promise<number>;
//# sourceMappingURL=setup-token.d.ts.map