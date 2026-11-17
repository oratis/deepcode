import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

import { type StoredMessage } from '@deepcode/core';
import {
  SessionManager,
  recoverToolResults,
  type JournalEvent,
  type SessionMeta,
} from '@deepcode/core/sessions';
import type { ThreadSnapshot, ThreadStore } from '@deepcode/protocol';

import { historyFromThread } from './runtime-executor.js';

function validThreadId(threadId: string): boolean {
  // `.` and `..` are spelled entirely in characters an id may legitimately
  // contain, so the class alone admits them. Harmless while every path built
  // from an id had a suffix appended; not harmless now that `delete` reaches a
  // recursive removal of `<root>/<id>`.
  if (threadId === '.' || threadId === '..') return false;
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
 * Journal-owned protocol projections with read-only legacy fallbacks.
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

  async assertForkable(threadId: string): Promise<void> {
    await this.sessions.assertForkable(threadId);
  }

  async load(threadId: string): Promise<ThreadSnapshot | null> {
    const projection = await this.sessions.journal(threadId).projection();
    if (projection?.deleted || projection?.archived) return null;
    if (projection?.thread)
      return { ...projection.thread, title: projection.meta?.title } as unknown as ThreadSnapshot;
    const session = await this.sessions.load(threadId);
    // Legacy JSONL has a shared TS/Rust read barrier; historical thread JSON does not.
    // Snapshot-only sessions remain viewable, but are not silently migrated as writable.
    if (!session) return projection ? null : this.snapshots.load(threadId);
    const imported = threadFromSession(session.meta, session.messages);
    return imported;
  }

  async save(thread: ThreadSnapshot): Promise<void> {
    await this.sessions.journal(thread.id).withWriter(async () => {
      const events = await this.sessions.journal(thread.id).read();
      if (
        !events &&
        !(await this.sessions.load(thread.id)) &&
        (await this.snapshots.load(thread.id))
      )
        throw new Error(
          'Snapshot-only legacy sessions are read-only. Resume with the previous release or start a new session.',
        );
      // A terminal snapshot must include all committed messages even when the
      // executor was cancelled, threw, or only published part of its item list.
      reconcileTerminalMessages(thread, events ?? []);
      await this.sessions.materialize(
        metaFromThread(thread),
        historyFromThread(thread),
        thread as unknown as Record<string, unknown>,
      );
    });
  }

  /**
   * Snapshots first, then any legacy session that has no snapshot yet — so a
   * listing shows everything a user has, not just what the app-server has
   * touched since 0.2.0. Legacy rows are projected lazily and not written.
   */
  async list(): Promise<ThreadSnapshot[]> {
    const ids = new Set([
      ...(await this.snapshots.list()).map((thread) => thread.id),
      ...(await this.sessions.list()).map((meta) => meta.id),
    ]);
    const threads: ThreadSnapshot[] = [];
    for (const id of ids) {
      const thread = await this.load(id);
      if (thread) threads.push(thread);
    }
    return threads;
  }

  async rename(threadId: string, title: string): Promise<void> {
    await this.withWriter(threadId, async () => {
      const thread = await this.load(threadId);
      if (!thread) throw new Error('Session not found');
      if (thread.turns.some((turn) => turn.status === 'in_progress'))
        throw new Error('Cannot rename an active session');
      await this.save(thread);
      const session = await this.sessions.load(threadId);
      await this.sessions.updateMeta({ ...session!.meta, title: title || undefined });
    });
  }
  fileSnapshots(threadId: string, path: string) {
    return this.sessions.fileSnapshots(threadId, path);
  }
  async withWriter<T>(threadId: string, run: () => Promise<T>): Promise<T> {
    return this.sessions.journal(threadId).withWriter(async () => {
      const projection = await this.sessions.journal(threadId).projection();
      if (projection?.timeline.some((event) => event.type === 'session.quarantined'))
        throw new Error('cleanup_incomplete: session is quarantined; start a new session');
      const thread = projection?.thread as unknown as ThreadSnapshot | undefined;
      if (thread?.turns.some((turn) => turn.status === 'in_progress')) {
        for (const turn of thread.turns) {
          if (turn.status !== 'in_progress') continue;
          turn.status = 'interrupted';
          turn.completedAt = new Date().toISOString();
          turn.items.push({
            id: `recovery-${turn.id}`,
            type: 'error',
            payload: {
              code: 'writer_interrupted',
              message:
                'Previous writer stopped before terminal commit. Tool effects may be partial; no tools were replayed.',
            },
            completedAt: turn.completedAt,
          });
        }
        await this.save(thread);
      }
      // Also finish an old host turn if the process died after the protocol's
      // terminal snapshot but before the host's terminal journal event.
      if (projection && !projection.deleted) await this.sessions.recoverInterrupted(threadId);
      return run();
    });
  }
  async archive(threadId: string): Promise<void> {
    await this.withWriter(threadId, async () => {
      const thread = await this.load(threadId);
      if (thread) await this.save(thread);
      await this.sessions.record(threadId, [{ type: 'session.archived', payload: {} }]);
    });
  }
  async delete(threadId: string): Promise<void> {
    await this.withWriter(threadId, async () => {
      await this.sessions.delete(threadId);
      await this.snapshots.delete(threadId);
    });
  }
}

function reconcileTerminalMessages(thread: ThreadSnapshot, events: readonly JournalEvent[]): void {
  for (const turn of thread.turns) {
    if (turn.status === 'in_progress') continue;
    const turnEvents = events.filter((event) => event.turnId === turn.id);
    const observed = turnEvents.filter((event) => event.type === 'message.observed');
    const input =
      turnEvents.find((event) => event.type === 'input.accepted')?.payload.text ??
      turn.items.find((item) => item.type === 'user_message')?.payload.text;
    // Consume matches one-for-one: two identical model messages are two facts.
    // Restrict matches to this turn, including on an idempotent recovery retry.
    const unmatched = turn.items.filter((item) => item.payload.message);
    for (const [index, event] of observed.entries()) {
      const message = event.payload.message as unknown as StoredMessage;
      if (
        index === 0 &&
        message.role === 'user' &&
        message.content.length === 1 &&
        message.content[0]?.type === 'text' &&
        message.content[0].text === input
      )
        continue;
      const match = unmatched.findIndex((item) => isDeepStrictEqual(item.payload.message, message));
      if (match !== -1) {
        unmatched.splice(match, 1);
        continue;
      }
      turn.items.push({
        id: `recovered-${event.eventId}`,
        type: message.role === 'assistant' ? 'assistant_message' : 'tool_result',
        payload: { message },
        completedAt: event.timestamp,
      });
    }
    const result = recoverToolResults(historyFromThread({ ...thread, turns: [turn] }), turnEvents);
    if (result)
      turn.items.push({
        id: `recovery-result-${turn.id}`,
        type: 'tool_result',
        payload: { message: result },
        completedAt: turn.completedAt ?? new Date().toISOString(),
      });
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
    title: thread.title ?? titleFrom(text),
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
    title: meta.title,
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
