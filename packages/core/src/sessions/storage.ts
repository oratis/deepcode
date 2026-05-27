// Session storage — jsonl persistence at ~/.deepcode/sessions/<sessionId>.jsonl
// Each line is one StoredMessage envelope.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5

import { promises as fs, createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { StoredMessage } from '../types.js';

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
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
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
  const files = sessionFiles(root, sessionId);
  try {
    await fs.access(files.jsonlPath);
  } catch {
    return [];
  }
  const out: StoredMessage[] = [];
  const rl = createInterface({ input: createReadStream(files.jsonlPath, { encoding: 'utf8' }) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as StoredMessage);
    } catch {
      // skip malformed lines (forward-compat)
    }
  }
  return out;
}

export async function listSessions(root: string): Promise<SessionMeta[]> {
  try {
    await fs.access(root);
  } catch {
    return [];
  }
  const entries = await fs.readdir(root);
  const metaFiles = entries.filter((f) => f.endsWith('.meta.json'));
  const metas = await Promise.all(
    metaFiles.map(async (f) => {
      try {
        const raw = await fs.readFile(join(root, f), 'utf8');
        return JSON.parse(raw) as SessionMeta;
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
