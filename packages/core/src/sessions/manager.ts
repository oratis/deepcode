// Session manager — high-level API: create / load / list sessions; append messages.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5

import type { StoredMessage } from '../types.js';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  appendMessage,
  defaultSessionsDir,
  deleteSession,
  listSessions as listSessionsLow,
  newSessionId,
  readMessages,
  readMeta,
  replaceSession,
  writeMeta,
  type SessionMeta,
} from './storage.js';
import {
  captureGitCheckpoint,
  captureSnapshot,
  listSnapshots,
  type Snapshot,
} from './snapshots.js';

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
  }

  async materialize(meta: SessionMeta, messages: StoredMessage[]): Promise<void> {
    await replaceSession(this.root, meta, messages);
  }

  async list(): Promise<SessionMeta[]> {
    return listSessionsLow(this.root);
  }

  /** UI projections cannot substitute for an engine's private resumable history. */
  async assertForkable(sessionId: string): Promise<void> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(sessionId)) throw new Error('Invalid session ID');
    const directory = join(this.root, sessionId);
    try {
      const binding = JSON.parse(await readFile(join(directory, 'engine.json'), 'utf8')) as {
        version: number;
        engine: string;
      };
      if (binding.version !== 1 || binding.engine !== 'native')
        throw new Error('This engine session cannot be forked. Start a new session instead.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    // Fail closed if an SDK session has lost its engine binding.
    try {
      await access(join(directory, 'claude-sdk'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    throw new Error('SDK session history cannot be forked. Start a new session instead.');
  }

  async delete(sessionId: string): Promise<void> {
    await deleteSession(this.root, sessionId);
  }

  async snapshot(args: {
    sessionId: string;
    cwd: string;
    filePath: string;
    reason: string;
    seq: number;
    turnId?: string;
  }): Promise<Snapshot | null> {
    return captureSnapshot({ ...args, sessionsRoot: this.root });
  }

  /** Capture a git working-tree checkpoint (used before Bash commands). */
  async gitCheckpoint(args: {
    sessionId: string;
    cwd: string;
    reason: string;
    seq: number;
    turnId?: string;
  }): Promise<Snapshot | null> {
    return captureGitCheckpoint({ ...args, sessionsRoot: this.root });
  }

  async snapshots(sessionId: string): Promise<Snapshot[]> {
    return listSnapshots({ sessionsRoot: this.root, sessionId });
  }
}
