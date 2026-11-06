import { type InitializeResult, type ProtocolEvent, type ProtocolMethod } from './types.js';
/** A transport owns one ordered, newline-free protocol message stream. */
export interface ProtocolClientConnection {
    open(onMessage: (message: string) => void, onDisconnect: (error: Error) => void): Promise<void>;
    send(message: string): Promise<void>;
    close(): Promise<void>;
}
/**
 * Provider- and host-neutral app-server client. Desktop, editors, and tests
 * supply only their connection adapter; request correlation, initialization,
 * disconnect behavior, and event fan-out stay identical across surfaces.
 */
export declare class ProtocolClient {
    private readonly connection;
    private readonly timeoutMs;
    private readonly pending;
    private readonly subscribers;
    private nextId;
    private opened;
    private initialized?;
    private connecting?;
    constructor(connection: ProtocolClientConnection, timeoutMs?: number);
    connect(): Promise<InitializeResult>;
    subscribe(handler: (event: ProtocolEvent) => void): () => void;
    request<T>(method: ProtocolMethod, params?: Record<string, unknown>): Promise<T>;
    close(): Promise<void>;
    private open;
    private receive;
    private disconnect;
    private rejectRequest;
    private rejectAll;
}
//# sourceMappingURL=client.d.ts.map