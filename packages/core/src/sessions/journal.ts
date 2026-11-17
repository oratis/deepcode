import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { readFile, open, rename, readdir, lstat, rm } from 'node:fs/promises';
import type { SessionMeta } from './storage.js';
import type { StoredMessage } from '../types.js';
import {
  acquireSessionLease,
  assertSessionId,
  durableFile,
  privateDirectory,
  syncDirectory,
} from './lease.js';

export interface JournalEvent {
  schemaVersion: 2;
  seq: number;
  eventId: string;
  sessionId: string;
  turnId?: string;
  stepId?: string;
  callId?: string;
  runEpoch: number;
  timestamp: string;
  type: string;
  payloadVersion: number;
  payload: Record<string, unknown>;
}
export type JournalInput = Pick<JournalEvent, 'type' | 'payload'> &
  Partial<Pick<JournalEvent, 'turnId' | 'stepId' | 'callId'>>;
interface Manifest {
  schemaVersion: 2;
  sessionId: string;
  generation: string;
  bytes: number;
  cursor: number;
  sha256: string;
}
export interface SessionProjection {
  cursor: number;
  meta: SessionMeta | null;
  messages: StoredMessage[];
  timeline: JournalEvent[];
  resources: Record<string, unknown>[];
  thread?: Record<string, unknown>;
  deleted: boolean;
  archived: boolean;
}
const known = new Set([
  'session.created',
  'session.meta',
  'session.imported',
  'session.deleted',
  'session.quarantined',
  'session.archived',
  'message.appended',
  'message.observed',
  'context.checkpoint',
  'thread.snapshot',
  'turn.started',
  'turn.finished',
  'model.selected',
  'input.accepted',
  'tool.intent',
  'tool.result',
  'approval.requested',
  'approval.decided',
  'engine.bound',
  'artifact.registered',
]);
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function message(value: unknown): value is StoredMessage {
  if (
    !record(value) ||
    !['user', 'assistant'].includes(String(value.role)) ||
    !Array.isArray(value.content)
  )
    return false;
  return value.content.every((block) => {
    if (!record(block)) return false;
    if (block.type === 'text' || block.type === 'thinking') return typeof block.text === 'string';
    if (block.type === 'tool_use')
      return typeof block.id === 'string' && typeof block.name === 'string' && record(block.input);
    if (block.type === 'tool_result')
      return typeof block.tool_use_id === 'string' && typeof block.content === 'string';
    return false;
  });
}
export function validateJournalEvent(event: JournalEvent, writable = false): void {
  if (
    event.schemaVersion !== 2 ||
    !Number.isSafeInteger(event.seq) ||
    event.seq < 1 ||
    !Number.isSafeInteger(event.runEpoch) ||
    event.runEpoch < 1 ||
    !event.eventId ||
    !event.timestamp ||
    !record(event.payload) ||
    typeof event.type !== 'string'
  )
    throw new Error('Invalid or future journal envelope');
  if (
    event.payloadVersion !== 1 ||
    (!known.has(event.type) && !event.type.startsWith('extension.'))
  )
    throw new Error(`Unsupported required journal event: ${event.type}`);
  if (writable && event.type.startsWith('extension.') && event.payload.required === true)
    throw new Error('Unknown required extension semantics');
  const p = event.payload;
  if (
    ['session.created', 'session.meta'].includes(event.type) &&
    (!record(p.meta) ||
      p.meta.id !== event.sessionId ||
      typeof p.meta.cwd !== 'string' ||
      typeof p.meta.createdAt !== 'string' ||
      typeof p.meta.updatedAt !== 'string')
  )
    throw new Error('Invalid journal metadata');
  if (['message.appended', 'message.observed'].includes(event.type) && !message(p.message))
    throw new Error('Invalid journal message');
  if (
    event.type === 'context.checkpoint' &&
    (!Array.isArray(p.messages) || !p.messages.every(message))
  )
    throw new Error('Invalid context checkpoint');
  if (
    event.type === 'thread.snapshot' &&
    (!record(p.thread) || p.thread.id !== event.sessionId || !Array.isArray(p.thread.turns))
  )
    throw new Error('Invalid thread projection');
  if (event.type.startsWith('tool.') && (!event.callId || typeof p.name !== 'string'))
    throw new Error('Invalid tool journal identity');
  if (event.type === 'engine.bound' && !['native', 'claude-sdk'].includes(String(p.engine)))
    throw new Error('Unknown session engine');
}
/** Pure, rebuildable projections. Model checkpoints never erase the audit timeline. */
export function projectJournal(events: readonly JournalEvent[]): SessionProjection {
  const projection: SessionProjection = {
    cursor: 0,
    meta: null,
    messages: [],
    timeline: [],
    resources: [],
    deleted: false,
    archived: false,
  };
  for (const event of events) {
    validateJournalEvent(event);
    projection.cursor = event.seq;
    if (event.type === 'session.created' || event.type === 'session.meta')
      projection.meta = event.payload.meta as unknown as SessionMeta;
    if (event.type === 'message.appended')
      projection.messages.push(event.payload.message as unknown as StoredMessage);
    if (event.type === 'context.checkpoint')
      projection.messages = [...(event.payload.messages as StoredMessage[])];
    if (event.type === 'thread.snapshot')
      projection.thread = event.payload.thread as Record<string, unknown>;
    if (event.type === 'artifact.registered') projection.resources.push(event.payload);
    if (event.type === 'session.archived') projection.archived = true;
    if (event.type === 'session.deleted') projection.deleted = true;
    projection.timeline.push(event);
  }
  return projection;
}
const ownership = new AsyncLocalStorage<{
  key: string;
  epoch: number;
  active: boolean;
  tail: Promise<unknown>;
}>();
/** Re-enter only the writer context for callbacks arriving from SDK/plugin transports. */
export function captureJournalWriterScope(): <T>(run: () => T) => T {
  const scope = ownership.getStore();
  return (run) => {
    if (!scope) return run();
    if (!scope.active) throw new Error('Session writer scope has ended');
    return ownership.run(scope, run);
  };
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** Committed manifest is the sole visibility boundary. JSONL tails are never guessed. */
export class SessionJournal {
  readonly directory: string;
  constructor(
    readonly root: string,
    readonly id: string,
  ) {
    assertSessionId(id);
    this.directory = join(root, id);
  }
  async withWriter<T>(operation: () => Promise<T>): Promise<T> {
    const key = resolve(this.directory);
    const held = ownership.getStore();
    if (held?.key === key) {
      if (!held.active) throw new Error('Session writer scope has ended');
      return operation();
    }
    await privateDirectory(this.root);
    await privateDirectory(this.directory);
    const lease = await acquireSessionLease(this.directory, this.id);
    const scope = {
      key,
      epoch: lease.epoch,
      active: true,
      tail: Promise.resolve() as Promise<unknown>,
    };
    try {
      return await ownership.run(scope, operation);
    } finally {
      scope.active = false;
      await scope.tail;
      await lease.release();
    }
  }
  private async manifest(): Promise<Manifest | null> {
    let raw: string;
    try {
      if (!(await lstat(join(this.directory, 'manifest.json'))).isFile())
        throw new Error('Manifest must be a regular file');
      raw = await readFile(join(this.directory, 'manifest.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const m = JSON.parse(raw) as Manifest;
    if (
      m.schemaVersion !== 2 ||
      m.sessionId !== this.id ||
      !/^[a-f0-9-]{36}$/.test(m.generation) ||
      !Number.isSafeInteger(m.bytes) ||
      m.bytes < 0 ||
      !Number.isSafeInteger(m.cursor) ||
      m.cursor < 0 ||
      !/^[a-f0-9]{64}$/.test(m.sha256)
    )
      throw new Error('Invalid or future session manifest');
    return m;
  }
  private async committed(m: Manifest): Promise<Buffer> {
    const path = join(this.directory, `journal-${m.generation}.jsonl`);
    if (!(await lstat(path)).isFile()) throw new Error('Journal must be a regular private file');
    const handle = await open(path, 'r');
    try {
      if ((await handle.stat()).size < m.bytes) throw new Error('Committed journal is truncated');
      const bytes = Buffer.alloc(m.bytes);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new Error('Committed journal is truncated');
        offset += bytesRead;
      }
      if (hash(bytes) !== m.sha256) throw new Error('Committed journal checksum mismatch');
      return bytes;
    } finally {
      await handle.close();
    }
  }
  private parse(m: Manifest, bytes: Buffer, writable = false): JournalEvent[] {
    if (bytes.length && bytes[bytes.length - 1] !== 10)
      throw new Error('Committed journal has an incomplete record');
    const events = bytes.length
      ? bytes
          .toString('utf8')
          .trimEnd()
          .split('\n')
          .map((line) => JSON.parse(line) as JournalEvent)
      : [];
    if (events.length !== m.cursor) throw new Error('Journal cursor mismatch');
    const ids = new Set<string>();
    for (const [i, event] of events.entries()) {
      validateJournalEvent(event, writable);
      if (event.seq !== i + 1 || event.sessionId !== this.id || ids.has(event.eventId))
        throw new Error('Journal identity or sequence mismatch');
      ids.add(event.eventId);
    }
    return events;
  }
  async read(): Promise<JournalEvent[] | null> {
    const manifest = await this.manifest();
    return manifest ? this.parse(manifest, await this.committed(manifest)) : null;
  }
  async projection(): Promise<SessionProjection | null> {
    const events = await this.read();
    return events ? projectJournal(events) : null;
  }
  async append(inputs: readonly JournalInput[]): Promise<void> {
    // Snapshot before waiting; a caller cannot change an approved fact during fsync.
    const immutable = structuredClone(inputs);
    return this.withWriter(async () => {
      const scope = ownership.getStore()!;
      const operation = scope.tail.then(async () => {
        if (!scope.active) throw new Error('Session writer scope has ended');
        const existing = await this.manifest();
        const bytes = existing ? await this.committed(existing) : Buffer.alloc(0);
        const prior = existing ? this.parse(existing, bytes, true) : [];
        if (prior.some((event) => event.type === 'session.deleted'))
          throw new Error('Session is deleted');
        if (!immutable.length) return;
        const generation = existing?.generation ?? randomUUID();
        const events: JournalEvent[] = immutable.map((input, i) => ({
          ...input,
          schemaVersion: 2,
          seq: prior.length + i + 1,
          eventId: randomUUID(),
          sessionId: this.id,
          runEpoch: scope.epoch,
          timestamp: new Date().toISOString(),
          payloadVersion: 1,
        }));
        events.forEach((event) => validateJournalEvent(event, true));
        if (!existing && events[0]?.type !== 'session.created')
          throw new Error('A new journal must start with session.created');
        const addition = Buffer.from(events.map((event) => JSON.stringify(event) + '\n').join(''));
        const path = join(this.directory, `journal-${generation}.jsonl`);
        const handle = await open(path, existing ? 'r+' : 'wx', 0o600);
        try {
          // Only bytes outside the committed manifest are repairable.
          await handle.truncate(bytes.length);
          let written = 0;
          while (written < addition.length) {
            const result = await handle.write(
              addition,
              written,
              addition.length - written,
              bytes.length + written,
            );
            if (!result.bytesWritten) throw new Error('Journal write made no progress');
            written += result.bytesWritten;
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        const all = Buffer.concat([bytes, addition]);
        const manifest: Manifest = {
          schemaVersion: 2,
          sessionId: this.id,
          generation,
          bytes: all.length,
          cursor: prior.length + events.length,
          sha256: hash(all),
        };
        const staged = join(this.directory, `manifest-${randomUUID()}.pending`);
        await durableFile(staged, JSON.stringify(manifest));
        await rename(staged, join(this.directory, 'manifest.json'));
        await syncDirectory(this.directory);
      });
      scope.tail = operation.catch(() => undefined);
      return operation;
    });
  }
  /** Explicit user deletion: publish a minimal tombstone, then remove private payloads. */
  async erase(): Promise<void> {
    await this.withWriter(async () => {
      const scope = ownership.getStore()!;
      const operation = scope.tail.then(async () => {
        if (!scope.active) throw new Error('Session writer scope has ended');
        const existing = await this.manifest();
        if (existing) this.parse(existing, await this.committed(existing), true);
        const epoch = ownership.getStore()!.epoch;
        const now = new Date().toISOString();
        const generation = randomUUID();
        const inputs: JournalInput[] = [
          {
            type: 'session.created',
            payload: { meta: { id: this.id, cwd: '', createdAt: now, updatedAt: now } },
          },
          { type: 'session.deleted', payload: {} },
        ];
        const events = inputs.map((input, index) => ({
          ...input,
          schemaVersion: 2,
          sessionId: this.id,
          seq: index + 1,
          eventId: randomUUID(),
          runEpoch: epoch,
          timestamp: now,
          payloadVersion: 1,
        }));
        const log = `journal-${generation}.jsonl`;
        const bytes = Buffer.from(events.map((event) => JSON.stringify(event) + '\n').join(''));
        await durableFile(join(this.directory, log), bytes);
        const temporary = join(this.directory, `manifest-${randomUUID()}.pending`);
        await durableFile(
          temporary,
          JSON.stringify({
            schemaVersion: 2,
            sessionId: this.id,
            generation,
            bytes: bytes.length,
            cursor: events.length,
            sha256: hash(bytes),
          }),
        );
        await rename(temporary, join(this.directory, 'manifest.json'));
        await syncDirectory(this.directory);
        // Keep ownership history and the tombstone so a retained legacy cache cannot resurrect it.
        for (const name of await readdir(this.directory))
          if (!['leases', 'manifest.json', log].includes(name))
            await rm(join(this.directory, name), { recursive: true, force: true });
        await syncDirectory(this.directory);
      });
      scope.tail = operation.catch(() => undefined);
      return operation;
    });
  }

  static async list(root: string): Promise<string[]> {
    try {
      return (await readdir(root, { withFileTypes: true }))
        .filter(
          (entry) => entry.isDirectory() && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(entry.name),
        )
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
