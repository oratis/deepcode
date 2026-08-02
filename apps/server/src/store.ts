import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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

  private pathFor(threadId: string): string {
    if (!validThreadId(threadId)) throw new Error(`Invalid thread id: ${threadId}`);
    return join(this.directory, `${threadId}.json`);
  }
}

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
