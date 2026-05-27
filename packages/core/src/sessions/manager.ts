// Session manager — high-level API: create / load / list sessions; append messages.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5

import type { StoredMessage } from '../types.js';
import {
  appendMessage,
  defaultSessionsDir,
  listSessions as listSessionsLow,
  newSessionId,
  readMessages,
  readMeta,
  touchSession,
  writeMeta,
  type SessionMeta,
} from './storage.js';
import { captureSnapshot, listSnapshots, type Snapshot } from './snapshots.js';

export interface SessionManagerOpts {
  root?: string;
}

export class SessionManager {
  readonly root: string;

  constructor(opts: SessionManagerOpts = {}) {
    this.root = opts.root ?? defaultSessionsDir();
  }

  async create(cwd: string, opts: { title?: string; model?: string } = {}): Promise<SessionMeta> {
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: newSessionId(),
      cwd,
      createdAt: now,
      updatedAt: now,
      title: opts.title,
      model: opts.model,
    };
    await writeMeta(this.root, meta);
    return meta;
  }

  async load(sessionId: string): Promise<{ meta: SessionMeta; messages: StoredMessage[] } | null> {
    const meta = await readMeta(this.root, sessionId);
    if (!meta) return null;
    const messages = await readMessages(this.root, sessionId);
    return { meta, messages };
  }

  async append(sessionId: string, msg: StoredMessage): Promise<void> {
    await appendMessage(this.root, sessionId, msg);
    await touchSession(this.root, sessionId);
  }

  async list(): Promise<SessionMeta[]> {
    return listSessionsLow(this.root);
  }

  async snapshot(args: {
    sessionId: string;
    cwd: string;
    filePath: string;
    reason: string;
    seq: number;
  }): Promise<Snapshot | null> {
    return captureSnapshot({ ...args, sessionsRoot: this.root });
  }

  async snapshots(sessionId: string): Promise<Snapshot[]> {
    return listSnapshots({ sessionsRoot: this.root, sessionId });
  }
}
