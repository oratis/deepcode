import { type AgentEvent, type Effort, type Mode, type RuntimeHost, type SessionManager, type StoredMessage } from '@deepcode/core';
import type { ThreadSnapshot } from '@deepcode/protocol';
import type { TurnExecutionArgs, TurnExecutionItem, TurnExecutor } from './server.js';
export interface RuntimeHostExecutorOptions {
    createHost: (cwd: string, mode: Mode, context: RuntimeHostCreationContext) => Promise<RuntimeHost | RuntimeHostLease> | RuntimeHost | RuntimeHostLease;
    systemPrompt?: string;
    model?: string;
    sessionManager?: SessionManager;
}
export interface RuntimeHostCreationContext {
    modeExplicit: boolean;
    signal: AbortSignal;
    requestApproval: (toolName: string, reason: string) => Promise<'allow' | 'deny' | 'always'>;
    reviewAction: {
        kind: 'apply' | 'revert';
    } | null;
}
export interface RuntimeHostLease {
    host: RuntimeHost;
    systemPrompt?: string;
    model?: string;
    effort?: Effort;
    diagnostics?: Array<{
        source: string;
        code: string;
        severity: 'warning' | 'error';
        message: string;
    }>;
    prepareUserMessage?: (text: string) => Promise<{
        text: string;
        diagnostics: Array<{
            source: string;
            code: string;
            severity: 'warning' | 'error';
            message: string;
        }>;
    }>;
    close?: () => Promise<void> | void;
}
export declare class RuntimeHostExecutor implements TurnExecutor {
    private readonly options;
    constructor(options: RuntimeHostExecutorOptions);
    execute(args: TurnExecutionArgs): Promise<{
        items: TurnExecutionItem[];
        status: "failed" | "completed";
    }>;
}
export declare function reviewFindingsFromEvents(events: AgentEvent[]): TurnExecutionItem[];
export declare function historyFromThread(thread: ThreadSnapshot): StoredMessage[];
//# sourceMappingURL=runtime-executor.d.ts.map