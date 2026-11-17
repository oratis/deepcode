import { createHash } from 'node:crypto';
// Session manager — high-level API: create / load / list sessions; append messages.
// Spec: docs/DEVELOPMENT_PLAN.md §3.5

import type { StoredMessage } from '../types.js';
import { access, readFile, realpath, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  defaultSessionsDir,
  listSessions as listSessionsLow,
  newSessionId,
  readMessages,
  readMeta,
  withLegacySessionLock,
  sessionFiles,
  type SessionMeta,
} from './storage.js';
import { SessionJournal, type JournalEvent, type JournalInput } from './journal.js';
import { importLegacySession } from './importer.js';
import { assertSessionId } from './lease.js';
import {
  captureGitCheckpoint,
  captureSnapshot,
  listSnapshots,
  type Snapshot,
} from './snapshots.js';

export interface SessionManagerOpts {
  root?: string;
  journalRoot?: string;
}

/** Repair a stopped transcript using committed results, without executing any tool. */
export function recoverToolResults(
  messages: readonly StoredMessage[],
  events: readonly JournalEvent[],
): StoredMessage | undefined {
  const pending = new Set<string>();
  for (const message of messages)
    for (const block of message.content) {
      if (block.type === 'tool_use') pending.add(block.id);
      if (block.type === 'tool_result') pending.delete(block.tool_use_id);
    }
  if (!pending.size) return undefined;
  const latest = [...events].reverse();
  return {
    role: 'user',
    content: [...pending].map((id) => {
      const source = latest.find(
        (event) =>
          ['message.appended', 'message.observed'].includes(event.type) &&
          (event.payload.message as unknown as StoredMessage).content.some(
            (block) => block.type === 'tool_use' && block.id === id,
          ),
      );
      // Native loops commit each assistant message before admitting its tools.
      // SDK bridges use fresh call IDs and commit the transcript after tool work.
      const observedAfterExecution = latest.some(
        (event) =>
          event.type === 'model.selected' &&
          event.turnId === source?.turnId &&
          event.payload.engine === 'claude-sdk',
      );
      // Providers may reuse call IDs even within a turn. An old successful
      // result must not answer a new call that stopped before its own intent.
      const intent = source
        ? latest.find(
            (event) =>
              event.type === 'tool.intent' &&
              event.callId === id &&
              (source.turnId === undefined || event.turnId === source.turnId) &&
              (observedAfterExecution || event.seq > source.seq),
          )
        : undefined;
      const result = intent
        ? (latest.find(
            (event) =>
              event.type === 'tool.result' &&
              event.callId === id &&
              event.turnId === intent.turnId &&
              event.seq > intent.seq,
          )?.payload.result as { content?: string; isError?: boolean } | undefined)
        : undefined;
      return {
        type: 'tool_result',
        tool_use_id: id,
        content:
          result?.content ??
          'Execution outcome unknown after host interruption. Inspect the workspace before retrying; this tool has not been replayed.',
        is_error: result ? (result.isError ?? false) : true,
      };
    }),
  };
}

export class SessionManager {
  /** Legacy read root, preserved for caller compatibility. All new writes use resourceRoot. */
  readonly root: string;
  readonly resourceRoot: string;

  constructor(opts: SessionManagerOpts = {}) {
    this.root = opts.root ?? defaultSessionsDir();
    this.resourceRoot = opts.journalRoot ?? `${this.root}-v2`;
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
    await this.journal(meta.id).append([{ type: 'session.created', payload: { meta } }]);
    return meta;
  }

  journal(sessionId: string): SessionJournal {
    return new SessionJournal(this.resourceRoot, sessionId);
  }

  async load(sessionId: string): Promise<{ meta: SessionMeta; messages: StoredMessage[] } | null> {
    const projection = await this.journal(sessionId).projection();
    if (projection)
      return projection.meta && !projection.deleted
        ? { meta: projection.meta, messages: projection.messages }
        : null;
    const meta = await readMeta(this.root, sessionId);
    return meta ? { meta, messages: await readMessages(this.root, sessionId) } : null;
  }

  /** Hold ownership for the entire turn, including approvals, processes and settlement. */
  async withWriter<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    return this.journal(sessionId).withWriter(async () => {
      await this.ensureWritable(sessionId);
      return run();
    });
  }
  private async ensureWritable(sessionId: string): Promise<void> {
    const journal = this.journal(sessionId);
    const events = await journal.read();
    if (events?.some((event) => event.type === 'session.quarantined'))
      throw new Error('cleanup_incomplete: session is quarantined; start a new session');
    if (events) return;
    if (!(await importLegacySession(this.root, journal)))
      throw new Error(`Session ${sessionId} does not exist`);
  }
  /** Owner-death recovery records uncertainty; it never replays a tool invocation. */
  async recoverInterrupted(sessionId: string): Promise<boolean> {
    return this.withWriter(sessionId, async () => {
      const events = (await this.journal(sessionId).read())!;
      const unfinished = new Set(
        events.filter((event) => event.type === 'turn.started').map((event) => event.turnId),
      );
      for (const event of events)
        if (event.type === 'turn.finished') unfinished.delete(event.turnId);
      const recovery: JournalInput[] = [];
      const projection = (await this.journal(sessionId).projection())!;
      const message = recoverToolResults(projection.messages, events);
      if (!unfinished.size && !message) return false;
      if (message)
        recovery.push({
          type: 'message.appended',
          payload: { message },
        });
      for (const turnId of unfinished)
        recovery.push({
          type: 'turn.finished',
          turnId,
          payload: {
            stopReason: 'aborted',
            recovered: true,
            note: 'Previous writer stopped before terminal commit; external effects may be partial.',
          },
        });
      await this.journal(sessionId).append(recovery);
      return true;
    });
  }

  async record(sessionId: string, events: readonly JournalInput[]): Promise<void> {
    await this.withWriter(sessionId, () => this.journal(sessionId).append(events));
  }
  async append(sessionId: string, msg: StoredMessage): Promise<void> {
    await this.record(sessionId, [{ type: 'message.appended', payload: { message: msg } }]);
  }
  async updateMeta(meta: SessionMeta): Promise<void> {
    await this.record(meta.id, [{ type: 'session.meta', payload: { meta } }]);
  }
  async materialize(
    meta: SessionMeta,
    messages: StoredMessage[],
    thread?: Record<string, unknown>,
  ): Promise<void> {
    await this.journal(meta.id).withWriter(async () => {
      let current = await this.journal(meta.id).projection();
      if (!current) {
        await importLegacySession(this.root, this.journal(meta.id));
        current = await this.journal(meta.id).projection();
      }
      const events: JournalInput[] = [];
      if (!current) events.push({ type: 'session.created', payload: { meta } });
      else
        events.push({
          type: 'session.meta',
          payload: { meta: { ...meta, title: current.meta?.title ?? meta.title } },
        });
      // Store a model checkpoint, never truncate the durable history to implement compaction.
      if (JSON.stringify(current?.messages ?? []) !== JSON.stringify(messages))
        events.push({ type: 'context.checkpoint', payload: { messages } });
      if (thread) events.push({ type: 'thread.snapshot', payload: { thread } });
      await this.journal(meta.id).append(events);
    });
  }
  async list(): Promise<SessionMeta[]> {
    const metas = new Map((await listSessionsLow(this.root)).map((meta) => [meta.id, meta]));
    for (const id of await SessionJournal.list(this.resourceRoot)) {
      const projection = await this.journal(id).projection();
      if (projection?.deleted) metas.delete(id);
      else if (projection?.meta) metas.set(id, projection.meta);
    }
    return [...metas.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** UI projections cannot substitute for an engine's private resumable history. */
  async assertForkable(sessionId: string): Promise<void> {
    assertSessionId(sessionId);
    const journal = await this.journal(sessionId).read();
    const directory = join(journal ? this.resourceRoot : this.root, sessionId);
    if (
      journal?.some((event) => event.type === 'engine.bound' && event.payload.engine !== 'native')
    )
      throw new Error('SDK session history cannot be forked');
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
    await this.journal(sessionId).withWriter(() =>
      withLegacySessionLock(this.root, sessionId, async () => {
        await this.journal(sessionId).erase();
        const files = sessionFiles(this.root, sessionId);
        for (const path of [
          files.jsonlPath,
          files.legacyJsonlPath,
          files.metaPath,
          join(this.root, sessionId),
        ])
          await rm(path, { recursive: true, force: true });
      }),
    );
  }

  async snapshot(args: {
    sessionId: string;
    cwd: string;
    filePath: string;
    reason: string;
    seq: number;
    turnId?: string;
  }): Promise<Snapshot | null> {
    return this.withWriter(args.sessionId, async () => {
      const snapshot = await captureSnapshot({ ...args, sessionsRoot: this.resourceRoot });
      if (snapshot)
        await this.record(args.sessionId, [
          {
            type: 'artifact.registered',
            turnId: args.turnId,
            payload: { kind: 'snapshot', ...snapshot },
          },
        ]);
      return snapshot;
    });
  }

  /** Capture a git working-tree checkpoint (used before Bash commands). */
  async gitCheckpoint(args: {
    sessionId: string;
    cwd: string;
    reason: string;
    seq: number;
    turnId?: string;
  }): Promise<Snapshot | null> {
    return this.withWriter(args.sessionId, async () => {
      const snapshot = await captureGitCheckpoint({ ...args, sessionsRoot: this.resourceRoot });
      if (snapshot)
        await this.record(args.sessionId, [
          {
            type: 'artifact.registered',
            turnId: args.turnId,
            payload: { kind: 'snapshot', ...snapshot },
          },
        ]);
      return snapshot;
    });
  }

  async snapshots(sessionId: string): Promise<Snapshot[]> {
    const root = (await this.journal(sessionId).read()) ? this.resourceRoot : this.root;
    return listSnapshots({ sessionsRoot: root, sessionId });
  }
  async fileSnapshots(sessionId: string, filePath: string) {
    assertSessionId(sessionId);
    const root = (await this.journal(sessionId).read()) ? this.resourceRoot : this.root;
    const directory = join(root, sessionId, 'snapshots');
    const rows = await this.snapshots(sessionId);
    const result: Array<{
      seq: number;
      capturedAtMs: number;
      reason: string;
      hash: string;
      content: string;
    }> = [];
    const requested = await realpath(filePath).catch(() => resolve(filePath));
    for (const row of rows) {
      if (
        row.kind === 'git' ||
        (await realpath(row.filePath).catch(() => resolve(row.filePath))) !== requested
      )
        continue;
      const blob = await realpath(row.blobPath);
      const base = await realpath(directory);
      if (!blob.startsWith(base + sep))
        throw new Error('Snapshot blob escapes its session resource directory');
      const content = await readFile(blob);
      if (createHash('sha256').update(content).digest('hex').slice(0, 16) !== row.hash)
        throw new Error('Snapshot content checksum mismatch');
      result.push({
        seq: row.seq,
        capturedAtMs: row.capturedAtMs ?? Date.parse(row.capturedAt),
        reason: row.reason,
        hash: row.hash,
        content: content.toString('utf8'),
      });
    }
    return result.sort((a, b) => a.seq - b.seq);
  }
}
