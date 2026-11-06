import type { ProtocolClientConnection } from '@deepcode/protocol';
export interface SpawnedAppServerOptions {
    command?: string;
    args?: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    home?: string;
    closeGraceMs?: number;
}
/** Node stdio adapter for a single-owner app-server child process. */
export declare class SpawnedAppServerConnection implements ProtocolClientConnection {
    private readonly options;
    private child?;
    private lines?;
    private closing;
    private stderr;
    constructor(options?: SpawnedAppServerOptions);
    open(onMessage: (message: string) => void, onDisconnect: (error: Error) => void): Promise<void>;
    send(message: string): Promise<void>;
    close(): Promise<void>;
    private detach;
}
//# sourceMappingURL=client.d.ts.map