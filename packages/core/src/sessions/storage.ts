// Session storage — jsonl persistence at ~/.deepcode/sessions/<sessionId>.jsonl
// Each line is one StoredMessage envelope.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { StoredMessage } from '../types.js';

export type SessionFormat = 'core-v0' | 'desktop-v0' | 'empty';

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
  metaPath: string;
  jsonlPath: string;
  snapshotsDir: string;
}

export function sessionFiles(root: string, sessionId: string): SessionFiles {
  return {
    metaPath: join(root, `${sessionId}.meta.json`),
    jsonlPath: join(root, `${sessionId}.jsonl`),
    snapshotsDir: join(root, sessionId, 'snapshots'),
  };
}

export async function writeMeta(root: string, meta: SessionMeta): Promise<void> {
  const files = sessionFiles(root, meta.id);
  await fs.mkdir(dirname(files.metaPath), { recursive: true });
  await fs.writeFile(files.metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

export async function readMeta(root: string, sessionId: string): Promise<SessionMeta | null> {
  const files = sessionFiles(root, sessionId);
  try {
    const raw = await fs.readFile(files.metaPath, 'utf8');
    return JSON.parse(raw) as SessionMeta;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return (await readSessionRecords(root, sessionId)).meta;
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
  await fs.mkdir(dirname(files.jsonlPath), { recursive: true });
  await fs.appendFile(files.jsonlPath, JSON.stringify(message) + '\n', 'utf8');
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
  return {
    id: value.id,
    cwd: typeof value.cwd === 'string' ? value.cwd : '',
    createdAt,
    updatedAt,
    model: typeof value.model === 'string' ? value.model : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
  };
}

/** Parse both historical JSONL layouts without modifying either one. */
export async function readSessionRecords(
  root: string,
  sessionId: string,
): Promise<SessionReadResult> {
  const files = sessionFiles(root, sessionId);
  let raw: string;
  let updatedAt: string;
  try {
    const [text, stat] = await Promise.all([
      fs.readFile(files.jsonlPath, 'utf8'),
      fs.stat(files.jsonlPath),
    ]);
    raw = text;
    updatedAt = stat.mtime.toISOString();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { format: 'empty', meta: null, messages: [], diagnostics: [] };
    }
    throw error;
  }

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
      format = 'desktop-v0';
      meta ??= desktopMeta(record, updatedAt);
      continue;
    }
    if (record.type === 'message') {
      format = 'desktop-v0';
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

export async function touchSession(root: string, sessionId: string): Promise<void> {
  const meta = await readMeta(root, sessionId);
  if (!meta) return;
  meta.updatedAt = new Date().toISOString();
  await writeMeta(root, meta);
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
