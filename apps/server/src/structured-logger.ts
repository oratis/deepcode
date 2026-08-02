import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_RETAINED_FILES = 3;
const TRACE_EVENTS = new Set([
  'protocol.request.started',
  'protocol.request.completed',
  'protocol.request.failed',
  'protocol.event',
  'turn.execution.started',
  'turn.execution.completed',
  'turn.execution.failed',
]);
const PROTOCOL_METHODS = new Set([
  'initialize',
  'config/diagnostics',
  'diagnostics/export',
  'workspace/diff',
  'thread/start',
  'thread/read',
  'thread/resume',
  'turn/start',
  'turn/interrupt',
  'approval/respond',
  'user-input/respond',
]);
const STATUSES = new Set([
  'ok',
  'error',
  'in_progress',
  'completed',
  'failed',
  'interrupted',
  'thread.started',
  'turn.started',
  'item.completed',
  'turn.completed',
  'turn.interrupted',
  'turn.failed',
  'item.delta',
  'tool.started',
  'tool.completed',
  'usage.updated',
  'approval.requested',
  'user-input.requested',
]);
const ERROR_CODES = new Set(['invalid_state', 'invalid_request', 'aborted', 'internal_error']);

/**
 * Bounded, best-effort NDJSON logging for the app-server trust boundary.
 * `record` rebuilds a value from a strict allowlist instead of serializing its
 * argument, so prompts, tool payloads, commands, and error messages cannot be
 * persisted accidentally.
 */
export class StructuredLogger {
  readonly path: string;
  private readonly now: () => string;
  private readonly maxBytes: number;
  private readonly retainedFiles: number;
  private tail = Promise.resolve();
  private lastError: Error | undefined;

  constructor(options: StructuredLoggerOptions) {
    this.path = join(options.directory, 'app-server.ndjson');
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.retainedFiles = options.retainedFiles ?? DEFAULT_RETAINED_FILES;
  }

  record(input: AppServerTraceRecord, level: StructuredLogRecord['level'] = 'info'): void {
    const record = normalizeRecord(input, level, this.now());
    const line = `${JSON.stringify(record)}\n`;
    this.tail = this.tail
      .then(() => this.append(line))
      .catch((error: unknown) => {
        this.lastError = error instanceof Error ? error : new Error(String(error));
      });
  }

  recordProtocolEvent(event: ProtocolEvent): void {
    const record = traceRecordForProtocolEvent(event);
    if (record) this.record(record);
  }

  async flush(): Promise<void> {
    await this.tail;
  }

  error(): Error | undefined {
    return this.lastError;
  }

  private async append(line: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await this.rotateIfNeeded(Buffer.byteLength(line));
    await appendFile(this.path, line, { encoding: 'utf8', mode: 0o600 });
    await chmod(this.path, 0o600);
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    let currentBytes = 0;
    try {
      currentBytes = (await stat(this.path)).size;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (currentBytes === 0 || currentBytes + incomingBytes <= this.maxBytes) return;

    if (this.retainedFiles > 0) {
      await ignoreMissing(() => unlink(`${this.path}.${this.retainedFiles}`));
      for (let index = this.retainedFiles - 1; index >= 1; index--) {
        await ignoreMissing(() => rename(`${this.path}.${index}`, `${this.path}.${index + 1}`));
      }
      await ignoreMissing(() => rename(this.path, `${this.path}.1`));
    } else {
      await ignoreMissing(() => unlink(this.path));
    }
  }
}

function normalizeRecord(
  input: AppServerTraceRecord,
  level: StructuredLogRecord['level'],
  timestamp: string,
): StructuredLogRecord {
  const record: StructuredLogRecord = {
    schemaVersion: 1,
    timestamp,
    level,
    event: allowedValue(input.event, TRACE_EVENTS),
    traceId: safeIdentifier(input.traceId, ['trace-']),
  };
  if (
    typeof input.protocolRequestId === 'number' &&
    Number.isSafeInteger(input.protocolRequestId)
  ) {
    record.protocolRequestId = input.protocolRequestId;
  } else if (typeof input.protocolRequestId === 'string') {
    record.protocolRequestId = opaqueIdentifier(input.protocolRequestId);
  }
  if (input.method) record.method = allowedValue(input.method, PROTOCOL_METHODS);
  if (input.threadId) record.threadId = safeIdentifier(input.threadId, ['thread-', 'legacy-']);
  if (input.turnId) record.turnId = safeIdentifier(input.turnId, ['turn-', 'legacy-']);
  if (input.itemId) {
    record.itemId = safeIdentifier(input.itemId, ['item-', 'call_', 'tool-', 'legacy-item-']);
  }
  if (input.status) record.status = allowedValue(input.status, STATUSES);
  if (input.code) record.code = allowedValue(input.code, ERROR_CODES);
  if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) {
    record.durationMs = Math.max(0, Math.round(input.durationMs));
  }
  return record;
}

/** Rebuild a record read from disk through the same strict schema used on write. */
export function sanitizeStructuredLogRecord(value: Record<string, unknown>): StructuredLogRecord {
  const input: AppServerTraceRecord = {
    event: typeof value.event === 'string' ? value.event : 'unknown',
    traceId: typeof value.traceId === 'string' ? value.traceId : 'unknown',
  };
  if (
    typeof value.protocolRequestId === 'string' ||
    (typeof value.protocolRequestId === 'number' && Number.isSafeInteger(value.protocolRequestId))
  ) {
    input.protocolRequestId = value.protocolRequestId;
  }
  for (const key of ['method', 'threadId', 'turnId', 'itemId', 'status', 'code'] as const) {
    if (typeof value[key] === 'string') input[key] = value[key];
  }
  if (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)) {
    input.durationMs = value.durationMs;
  }
  const level =
    value.level === 'warning' || value.level === 'error' || value.level === 'info'
      ? value.level
      : 'error';
  return normalizeRecord(input, level, safeTimestamp(value.timestamp));
}

function allowedValue(value: string, choices: ReadonlySet<string>): string {
  return choices.has(value) ? value : 'unknown';
}

function safeIdentifier(value: string, prefixes: string[]): string {
  if (
    value.length <= 160 &&
    /^[a-zA-Z0-9._-]+$/.test(value) &&
    prefixes.some((prefix) => value.startsWith(prefix))
  ) {
    return value;
  }
  return opaqueIdentifier(value);
}

function opaqueIdentifier(value: string): string {
  return `hash-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

function safeTimestamp(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : 'unknown';
}

function traceRecordForProtocolEvent(event: ProtocolEvent): AppServerTraceRecord | null {
  const traceId = event.traceId;
  if (!traceId) return null;
  switch (event.type) {
    case 'thread.started':
      return { event: 'protocol.event', traceId, threadId: event.thread.id, status: event.type };
    case 'turn.started':
    case 'turn.completed':
    case 'turn.interrupted':
    case 'turn.failed':
      return {
        event: 'protocol.event',
        traceId,
        threadId: event.threadId,
        turnId: event.turn.id,
        status: event.type,
      };
    case 'item.completed':
      return {
        event: 'protocol.event',
        traceId,
        threadId: event.threadId,
        turnId: event.turnId,
        itemId: event.item.id,
        status: event.type,
      };
    default:
      return {
        event: 'protocol.event',
        traceId,
        threadId: event.threadId,
        turnId: event.turnId,
        itemId: 'itemId' in event ? event.itemId : undefined,
        status: event.type,
      };
  }
}

async function ignoreMissing(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
