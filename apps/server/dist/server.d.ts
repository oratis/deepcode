import { type CompletedItemType, type ConfigDiagnosticsResult, type RuntimeCapabilitiesResult, type DiagnosticExportResult, type ProtocolEvent, type ProtocolRequest, type ProtocolResponse, type ThreadSnapshot, type ThreadStore, type TurnSnapshot, type WorkspaceDiffResult } from '@deepcode/protocol';
export interface TurnExecutionItem {
    type: CompletedItemType;
    payload: Record<string, unknown>;
}
export interface TurnExecutionResult {
    items?: TurnExecutionItem[];
    status?: 'completed' | 'failed';
}
export interface TurnExecutionArgs {
    thread: ThreadSnapshot;
    turn: TurnSnapshot;
    input: Record<string, unknown>;
    signal: AbortSignal;
    publishDelta: (itemId: string, delta: string) => void;
    publishReasoning: (itemId: string, delta: string) => void;
    publishToolStarted: (itemId: string, name: string, input: Record<string, unknown>) => void;
    publishToolCompleted: (itemId: string, result: {
        content: string;
        isError?: boolean;
    }) => void;
    publishUsage: (usage: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens?: number;
        cacheReadTokens?: number;
    }) => void;
    requestApproval: (toolName: string, reason: string) => Promise<'allow' | 'deny' | 'always'>;
    requestUserInput: (request: {
        question: string;
        options: Array<{
            label: string;
            description: string;
        }>;
        multiSelect?: boolean;
    }) => Promise<string>;
}
export interface TurnExecutor {
    execute(args: TurnExecutionArgs): Promise<TurnExecutionResult>;
}
export interface AppServerOptions {
    executor: TurnExecutor;
    store?: ThreadStore;
    now?: () => string;
    newId?: (prefix: 'thread' | 'turn' | 'item') => string;
    newTraceId?: () => string;
    onEvent?: (event: ProtocolEvent) => void;
    onTrace?: (record: AppServerTraceRecord) => void;
    configDiagnostics?: (cwd: string) => Promise<ConfigDiagnosticsResult>;
    runtimeCapabilities?: (cwd: string) => Promise<RuntimeCapabilitiesResult>;
    diagnosticExport?: (cwd: string) => Promise<DiagnosticExportResult>;
    workspaceDiff?: (cwd: string) => Promise<WorkspaceDiffResult>;
}
/** Strictly metadata-only records; no prompt, tool payload, command, or error message. */
export interface AppServerTraceRecord {
    event: string;
    traceId: string;
    protocolRequestId?: string | number;
    method?: string;
    threadId?: string;
    turnId?: string;
    itemId?: string;
    status?: string;
    code?: string;
    durationMs?: number;
}
export declare class AppServer {
    private readonly options;
    private readonly lifecycle;
    private readonly activeTurns;
    private readonly terminalTransitions;
    private readonly pendingInteractions;
    private interactionSequence;
    private readonly newTraceId;
    constructor(options: AppServerOptions);
    handle(request: ProtocolRequest): Promise<ProtocolResponse>;
    waitForIdle(): Promise<void>;
    shutdown(): Promise<void>;
    private dispatch;
    private resumeThread;
    private applyReviewFindings;
    private revertReviewAction;
    private startTurn;
    private interruptTurn;
    private executeTurn;
    private requestApproval;
    private requestUserInput;
    private respondToApproval;
    private respondToUserInput;
    private requireInteraction;
    private cancelInteractions;
    private nextInteractionId;
    private trace;
    private finishOnce;
}
//# sourceMappingURL=server.d.ts.map