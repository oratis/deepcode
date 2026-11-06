import { type InitializeResult, type ProtocolEvent, type ProtocolMethod } from '@deepcode/protocol';
export interface LspMessage {
    jsonrpc: '2.0';
    id?: number | string | null;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}
export type SendFn = (msg: LspMessage) => void;
interface AppServerClient {
    connect(): Promise<InitializeResult>;
    request<T>(method: ProtocolMethod, params?: Record<string, unknown>): Promise<T>;
    subscribe(handler: (event: ProtocolEvent) => void): () => void;
    close(): Promise<void>;
}
interface ServerState {
    initialized: boolean;
    rootUri?: string;
    threadId?: string;
    client?: AppServerClient;
    unsubscribe?: () => void;
    clientFactory: () => AppServerClient;
    activeTurns: Map<string, string>;
    turnSinks: Map<string, SendFn>;
    queuedEvents: Map<string, ProtocolEvent[]>;
    latestSend?: SendFn;
}
export declare function handleMessage(msg: LspMessage, send: SendFn): Promise<void>;
declare function dispatch(msg: LspMessage, send: SendFn): Promise<unknown>;
export declare const __test: {
    state: ServerState;
    dispatch: typeof dispatch;
    setClientFactory(factory: () => AppServerClient): void;
    reset(): Promise<void>;
};
export {};
//# sourceMappingURL=handler.d.ts.map