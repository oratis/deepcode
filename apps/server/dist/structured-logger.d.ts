import type { ProtocolEvent } from '@deepcode/protocol';
import type { AppServerTraceRecord } from './server.js';
export interface StructuredLoggerOptions {
    directory: string;
    now?: () => string;
    maxBytes?: number;
    retainedFiles?: number;
}
export interface StructuredLogRecord extends AppServerTraceRecord {
    schemaVersion: 1;
    timestamp: string;
    level: 'info' | 'warning' | 'error';
}
/**
 * Bounded, best-effort NDJSON logging for the app-server trust boundary.
 * `record` rebuilds a value from a strict allowlist instead of serializing its
 * argument, so prompts, tool payloads, commands, and error messages cannot be
 * persisted accidentally.
 */
export declare class StructuredLogger {
    readonly path: string;
    private readonly now;
    private readonly maxBytes;
    private readonly retainedFiles;
    private tail;
    private lastError;
    constructor(options: StructuredLoggerOptions);
    record(input: AppServerTraceRecord, level?: StructuredLogRecord['level']): void;
    recordProtocolEvent(event: ProtocolEvent): void;
    flush(): Promise<void>;
    error(): Error | undefined;
    private append;
    private rotateIfNeeded;
}
/** Rebuild a record read from disk through the same strict schema used on write. */
export declare function sanitizeStructuredLogRecord(value: Record<string, unknown>): StructuredLogRecord;
//# sourceMappingURL=structured-logger.d.ts.map