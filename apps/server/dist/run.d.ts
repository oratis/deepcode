import type { Readable, Writable } from 'node:stream';
import { type TurnExecutor } from './server.js';
export interface RunAppServerOptions {
    input: Readable;
    output: Writable;
    home: string;
    executor?: TurnExecutor;
    forceFileCredentials?: boolean;
}
export declare function runAppServer(options: RunAppServerOptions): Promise<void>;
//# sourceMappingURL=run.d.ts.map