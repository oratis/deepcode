// Session storage — canonical v1 JSONL plus read-only legacy compatibility.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { StoredMessage } from '../types.js';

export type SessionFormat = 'canonical-v1' | 'core-v0' | 'desktop-v0' | 'empty';

export interface SessionDiagnostic {
  line: number;
  code: 'truncated_tail' | 'invalid_json' | 'invalid_message';
  message: string;
  fatal: boolean;
}

export interface SessionReadResult {
  format: SessionFormat;
  meta: SessionMeta | null;
  messages: StoredMessage[];
  diagnostics: SessionDiagnostic[];
}

export class SessionCorruptionError extends Error {
  constructor(
    readonly sessionId: string,
    readonly diagnostics: SessionDiagnostic[],
  ) {
    super(
      `Session ${sessionId} is corrupted at ${diagnostics
        .filter((d) => d.fatal)
        .map((d) => `line ${d.line}: ${d.message}`)
        .join('; ')}`,
    );
    this.name = 'SessionCorruptionError';
  }
}

export class SessionWriterConflictError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} already has an active writer`);
    this.name = 'SessionWriterConflictError';
  }
}

export interface SessionMeta {
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  title?: string;
}

export function defaultSessionsDir(): string {
  return process.env.DEEPCODE_SESSIONS_DIR ?? join(homedir(), '.deepcode', 'sessions');
}

export interface SessionFiles {
  /** Read-only core v0 metadata sidecar. */
  metaPath: string;
  /** Canonical v1 stream used for all new writes. */
  jsonlPath: string;
  /** Read-only core/desktop v0 stream. */
  legacyJsonlPath: string;
  writerLockPath: string;
  snapshotsDir: string;
}

export function sessionFiles(root: string, sessionId: string): SessionFiles {
  return {
    metaPath: join(root, `${sessionId}.meta.json`),
    jsonlPath: join(root, `${sessionId}.v1.jsonl`),
    legacyJsonlPath: join(root, `${sessionId}.jsonl`),
    writerLockPath: join(root, `${sessionId}.writer.lock`),
    snapshotsDir: join(root, sessionId, 'snapshots'),
  };
}

export async function writeMeta(root: string, meta: SessionMeta): Promise<void> {
  const files = sessionFiles(root, meta.id);
  await withWriterLock(files, meta.id, async () => {
    let messages: StoredMessage[] = [];
    try {
      const parsed = await readRecordsFromPath(files.jsonlPath);
      const fatal = parsed.diagnostics.filter((diagnostic) => diagnostic.fatal);
      if (fatal.length > 0) throw new SessionCorruptionError(meta.id, fatal);
      messages = parsed.messages;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeCanonical(files.jsonlPath, meta, messages);
  });
}

export async function readMeta(root: string, sessionId: string): Promise<SessionMeta | null> {
  const files = sessionFiles(root, sessionId);
  const records = await readSessionRecords(root, sessionId);
  if (records.format === 'canonical-v1' && records.meta) return records.meta;
  try {
    const raw = await fs.readFile(files.metaPath, 'utf8');
    return JSON.parse(raw) as SessionMeta;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return records.meta;
    }
    throw err;
  }
}

export async function appendMessage(
  root: string,
  sessionId: string,
  message: StoredMessage,
): Promise<void> {
  const files = sessionFiles(root, sessionId);
  await withWriterLock(files, sessionId, async () => {
    await ensureCanonical(sessionId, files);
    await fs.appendFile(files.jsonlPath, JSON.stringify(messageRecord(message)) + '\n', 'utf8');
  });
}

/**
 * Atomically materialize the complete canonical session projection.
 *
 * Protocol stores use this idempotent full rewrite while their richer lifecycle
 * snapshot remains the source of truth. A title written by another compatible
 * client is always preserved; explicit rename continues to use `writeMeta`.
 */
export async function replaceSession(
  root: string,
  meta: SessionMeta,
  messages: StoredMessage[],
): Promise<void> {
  const files = sessionFiles(root, meta.id);
  await withWriterLock(files, meta.id, async () => {
    const current = await readMeta(root, meta.id);
    await writeCanonical(
      files.jsonlPath,
      {
        ...meta,
        title: current?.title ?? meta.title,
      },
      messages,
    );
  });
}

export async function readMessages(root: string, sessionId: string): Promise<StoredMessage[]> {
  const result = await readSessionRecords(root, sessionId);
  const fatal = result.diagnostics.filter((diagnostic) => diagnostic.fatal);
  if (fatal.length > 0) throw new SessionCorruptionError(sessionId, fatal);
  return result.messages;
}

function isStoredMessage(value: unknown): value is StoredMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (record.role === 'user' || record.role === 'assistant') && Array.isArray(record.content);
}

function desktopMeta(value: Record<string, unknown>, updatedAt: string): SessionMeta | null {
  if (value.type !== 'session_meta' || typeof value.id !== 'string') return null;
  const createdAt =
    typeof value.created_at === 'number'
      ? new Date(value.created_at * 1000).toISOString()
      : typeof value.created_at === 'string'
        ? value.created_at
        : updatedAt;
  const normalizedUpdatedAt =
    value.schema_version === 1 && typeof value.updated_at === 'string'
      ? value.updated_at
      : updatedAt;
  return {
    id: value.id,
    cwd: typeof value.cwd === 'string' ? value.cwd : '',
    createdAt,
    updatedAt: normalizedUpdatedAt,
    model: typeof value.model === 'string' ? value.model : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
  };
}

function metaRecord(meta: SessionMeta): Record<string, unknown> {
  return {
    type: 'session_meta',
    schema_version: 1,
    id: meta.id,
    cwd: meta.cwd,
    created_at: meta.createdAt,
    updated_at: meta.updatedAt,
    ...(meta.model ? { model: meta.model } : {}),
    ...(meta.title ? { title: meta.title } : {}),
  };
}

function messageRecord(message: StoredMessage): Record<string, unknown> {
  return { type: 'message', schema_version: 1, ...message };
}

async function writeCanonical(
  path: string,
  meta: SessionMeta,
  messages: StoredMessage[],
): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body = [metaRecord(meta), ...messages.map(messageRecord)]
    .map((record) => JSON.stringify(record))
    .join('\n');
  await fs.writeFile(tempPath, body + '\n', { encoding: 'utf8', flag: 'wx' });
  await fs.rename(tempPath, path);
}

async function withWriterLock<T>(
  files: SessionFiles,
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  await fs.mkdir(dirname(files.writerLockPath), { recursive: true });
  let lock: Awaited<ReturnType<typeof fs.open>>;
  try {
    lock = await fs.open(files.writerLockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new SessionWriterConflictError(sessionId);
    }
    throw error;
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return await operation();
  } finally {
    await lock.close();
    await fs.unlink(files.writerLockPath).catch(() => undefined);
  }
}

async function ensureCanonical(sessionId: string, files: SessionFiles): Promise<void> {
  try {
    await fs.access(files.jsonlPath);
    return;
  } catch {
    // Normalize below while holding the writer lock.
  }

  const legacy = await readRecordsFromPath(files.legacyJsonlPath).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return { format: 'empty', meta: null, messages: [], diagnostics: [] } as SessionReadResult;
      }
      throw error;
    },
  );
  const fatal = legacy.diagnostics.filter((diagnostic) => diagnostic.fatal);
  if (fatal.length > 0) throw new SessionCorruptionError(sessionId, fatal);

  let sidecar: SessionMeta | null = null;
  try {
    sidecar = JSON.parse(await fs.readFile(files.metaPath, 'utf8')) as SessionMeta;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const now = new Date().toISOString();
  const meta = legacy.meta ??
    sidecar ?? {
      id: sessionId,
      cwd: '',
      createdAt: now,
      updatedAt: now,
    };
  await writeCanonical(files.jsonlPath, meta, legacy.messages);
}

/** Parse both historical JSONL layouts without modifying either one. */
export async function readSessionRecords(
  root: string,
  sessionId: string,
): Promise<SessionReadResult> {
  const files = sessionFiles(root, sessionId);
  try {
    return await readRecordsFromPath(files.jsonlPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    return await readRecordsFromPath(files.legacyJsonlPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { format: 'empty', meta: null, messages: [], diagnostics: [] };
    }
    throw error;
  }
}

async function readRecordsFromPath(path: string): Promise<SessionReadResult> {
  const [raw, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)]);
  const updatedAt = stat.mtime.toISOString();

  const lines = raw.split('\n');
  let lastContentIndex = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (lines[index]!.trim().length > 0) {
      lastContentIndex = index;
      break;
    }
  }
  const messages: StoredMessage[] = [];
  const diagnostics: SessionDiagnostic[] = [];
  let meta: SessionMeta | null = null;
  let format: SessionFormat = 'empty';

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      const isTruncatedTail = index === lastContentIndex && !raw.endsWith('\n');
      diagnostics.push({
        line: index + 1,
        code: isTruncatedTail ? 'truncated_tail' : 'invalid_json',
        message: isTruncatedTail
          ? 'ignored an incomplete final JSONL record'
          : `invalid JSON: ${(error as Error).message}`,
        fatal: !isTruncatedTail,
      });
      continue;
    }
    if (!value || typeof value !== 'object') {
      diagnostics.push({
        line: index + 1,
        code: 'invalid_message',
        message: 'record must be a JSON object',
        fatal: true,
      });
      continue;
    }

    const record = value as Record<string, unknown>;
    if (record.type === 'session_meta') {
      format = record.schema_version === 1 ? 'canonical-v1' : 'desktop-v0';
      meta ??= desktopMeta(record, updatedAt);
      continue;
    }
    if (record.type === 'message') {
      if (format !== 'canonical-v1') {
        format = record.schema_version === 1 ? 'canonical-v1' : 'desktop-v0';
      }
      if (isStoredMessage(record)) {
        messages.push({
          role: record.role,
          content: record.content,
          timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
        });
      } else {
        diagnostics.push({
          line: index + 1,
          code: 'invalid_message',
          message: 'message record has an invalid role or content array',
          fatal: true,
        });
      }
      continue;
    }
    if (record.type === undefined) {
      format = 'core-v0';
      if (isStoredMessage(record)) messages.push(record);
      else {
        diagnostics.push({
          line: index + 1,
          code: 'invalid_message',
          message: 'bare record has an invalid role or content array',
          fatal: true,
        });
      }
      continue;
    }
    // Unknown typed records are reserved for forward-compatible lifecycle
    // items. They are not messages and are intentionally ignored.
  }

  return { format, meta, messages, diagnostics };
}

export async function listSessions(root: string): Promise<SessionMeta[]> {
  try {
    await fs.access(root);
  } catch {
    return [];
  }
  const entries = await fs.readdir(root);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.endsWith('.meta.json')) ids.add(entry.slice(0, -'.meta.json'.length));
    else if (entry.endsWith('.v1.jsonl')) ids.add(entry.slice(0, -'.v1.jsonl'.length));
    else if (entry.endsWith('.jsonl')) ids.add(entry.slice(0, -'.jsonl'.length));
  }
  const metas = await Promise.all(
    [...ids].map(async (id) => {
      try {
        return await readMeta(root, id);
      } catch {
        return null;
      }
    }),
  );
  return metas
    .filter((m): m is SessionMeta => m !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function newSessionId(): string {
  // Short prefix + uuid-ish — collision risk is negligible at this scale.
  const ts = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rnd}`;
}
