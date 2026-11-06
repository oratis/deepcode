import type { Readable, Writable } from 'node:stream';
import { type ProtocolNotification, type ProtocolResponse } from '@deepcode/protocol';
import type { AppServer } from './server.js';
type OutboundMessage = ProtocolResponse | ProtocolNotification;
export declare class ProtocolLineWriter {
    private readonly output;
    private readonly maxPending;
    private tail;
    private failure;
    private pending;
    constructor(output: Writable, maxPending?: number);
    enqueue(message: OutboundMessage): Promise<void>;
    flush(): Promise<void>;
}
export declare function serveStdio(server: AppServer, input: Readable, destination: Writable | ProtocolLineWriter): Promise<void>;
export {};
//# sourceMappingURL=stdio.d.ts.map