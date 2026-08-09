import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import { type StoredMessage } from '@deepcode/core';
import { SessionManager, type SessionMeta } from '@deepcode/core/sessions';
import type { ThreadSnapshot, ThreadStore } from '@deepcode/protocol';

import { historyFromThread } from './runtime-executor.js';

function validThreadId(threadId: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(threadId);
}

export class FileThreadStore implements ThreadStore {
  private sequence = 0;

  constructor(readonly directory: string) {}

  async load(threadId: string): Promise<ThreadSnapshot | null> {
    const path = this.pathFor(threadId);
    try {
      return JSON.parse(await readFile(path, 'utf8')) as ThreadSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(thread: ThreadSnapshot): Promise<void> {
    const path = this.pathFor(thread.id);
    await mkdir(this.directory, { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${++this.sequence}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(thread)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  }

  async list(): Promise<ThreadSnapshot[]> {
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const threads: ThreadSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      // A snapshot written by a concurrent save can be mid-rename; skipping an
      // unreadable one is better than failing the whole listing.
      try {
        threads.push(JSON.parse(await readFile(join(this.directory, entry), 'utf8')));
      } catch {
        continue;
      }
    }
    return threads;
  }

  async archive(threadId: string): Promise<void> {
    const path = this.pathFor(threadId);
    const target = join(this.directory, ARCHIVED_DIR);
    await mkdir(target, { recursive: true });
    await rename(path, join(target, `${threadId}.json`));
  }

  async delete(threadId: string): Promise<void> {
    // `force` so deleting an already-archived thread is not an error: the
    // runtime has already established the thread exists, and failing here would
    // leave the caller unable to finish a delete it can see the reason for.
    await rm(this.pathFor(threadId), { force: true });
  }

  private pathFor(threadId: string): string {
    if (!validThreadId(threadId)) throw new Error(`Invalid thread id: ${threadId}`);
    return join(this.directory, `${threadId}.json`);
  }
}

const ARCHIVED_DIR = 'archived';

/**
 * Rich protocol snapshots plus a canonical session-v1 message projection.
 *
 * The protocol snapshot preserves lifecycle/items. The canonical projection
 * keeps the existing CLI/desktop session index and legacy readers continuous
 * during rollout. Both use the same id, and legacy-only sessions are imported
 * lazily the first time the app-server resumes them.
 */
export class CanonicalThreadStore implements ThreadStore {
  private readonly snapshots: FileThreadStore;
  private readonly sessions: SessionManager;

  constructor(snapshotDirectory: string, sessionsDirectory: string) {
    this.snapshots = new FileThreadStore(snapshotDirectory);
    this.sessions = new SessionManager({ root: sessionsDirectory });
  }

  async load(threadId: string): Promise<ThreadSnapshot | null> {
    const snapshot = await this.snapshots.load(threadId);
    if (snapshot) return snapshot;
    const session = await this.sessions.load(threadId);
    if (!session) return null;
    const imported = threadFromSession(session.meta, session.messages);
    await this.snapshots.save(imported);
    return imported;
  }

  async save(thread: ThreadSnapshot): Promise<void> {
    const messages = historyFromThread(thread);
    await this.sessions.materialize(metaFromThread(thread), messages);
    await this.snapshots.save(thread);
  }

  /**
   * Snapshots first, then any legacy session that has no snapshot yet — so a
   * listing shows everything a user has, not just what the app-server has
   * touched since 0.2.0. Legacy rows are projected lazily and not written.
   */
  async list(): Promise<ThreadSnapshot[]> {
    const threads = await this.snapshots.list();
    const seen = new Set(threads.map((thread) => thread.id));
    for (const meta of await this.sessions.list()) {
      if (seen.has(meta.id)) continue;
      const session = await this.sessions.load(meta.id);
      if (session) threads.push(threadFromSession(session.meta, session.messages));
    }
    return threads;
  }

  async archive(threadId: string): Promise<void> {
    await this.snapshots.archive(threadId);
  }

  /**
   * Drop both representations of a thread.
   *
   * The snapshot and the canonical session projection share an id and are two
   * views of one thing, so removing one and leaving the other is how a deleted
   * thread comes back in the next listing — the composite `list` reads both.
   */
  async delete(threadId: string): Promise<void> {
    await this.snapshots.delete(threadId);
    await this.sessions.delete(threadId);
  }
}

function metaFromThread(thread: ThreadSnapshot): SessionMeta {
  const firstInput = thread.turns
    .flatMap((turn) => turn.items)
    .find((item) => item.type === 'user_message');
  const text = typeof firstInput?.payload.text === 'string' ? firstInput.payload.text : '';
  const model =
    typeof firstInput?.payload.model === 'string' ? firstInput.payload.model : undefined;
  return {
    id: thread.id,
    cwd: thread.cwd,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    title: titleFrom(text),
    model,
  };
}

function titleFrom(text: string): string | undefined {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? [...firstLine].slice(0, 60).join('') : undefined;
}

function threadFromSession(meta: SessionMeta, messages: StoredMessage[]): ThreadSnapshot {
  if (messages.length === 0) {
    return {
      id: meta.id,
      cwd: meta.cwd,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      turns: [],
    };
  }
  return {
    id: meta.id,
    cwd: meta.cwd,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    turns: [
      {
        id: `legacy-${meta.id}`,
        threadId: meta.id,
        status: 'completed',
        startedAt: meta.createdAt,
        completedAt: meta.updatedAt,
        items: messages.map((message, index) => itemFromMessage(message, meta, index)),
      },
    ],
  };
}

function itemFromMessage(message: StoredMessage, meta: SessionMeta, index: number) {
  const only = message.content.length === 1 ? message.content[0] : undefined;
  const simpleUserText = message.role === 'user' && only?.type === 'text' ? only.text : undefined;
  return {
    id: `legacy-item-${index + 1}`,
    type:
      message.role === 'assistant'
        ? ('assistant_message' as const)
        : simpleUserText !== undefined
          ? ('user_message' as const)
          : ('tool_result' as const),
    payload: simpleUserText !== undefined ? { text: simpleUserText } : { message },
    completedAt: message.timestamp ?? meta.updatedAt,
  };
}
