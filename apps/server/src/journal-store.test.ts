import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ThreadSnapshot, TurnSnapshot } from '@deepcode/protocol';
import { SessionManager } from '@deepcode/core/sessions';
import { RuntimeHost, ToolRegistry, type StoredMessage } from '@deepcode/core';
import { AppServer } from './server.js';
import { CanonicalThreadStore } from './store.js';
import { RuntimeHostExecutor } from './runtime-executor.js';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('holds session ownership from admission until cancellation has drained and terminal is committed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dc-journal-server-'));
  roots.push(root);
  const store = () => new CanonicalThreadStore(join(root, 'threads-v1'), join(root, 'sessions'));
  let firstDrained = false;
  const a = new AppServer({
    store: store(),
    executor: {
      async execute({ signal }) {
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => setTimeout(resolve, 30), { once: true }),
        );
        firstDrained = true;
        return {};
      },
    },
  });
  let calls = 0;
  const b = new AppServer({
    store: store(),
    executor: {
      async execute() {
        calls++;
        return {};
      },
    },
  });
  const started = await a.handle({ id: 1, method: 'thread/start', params: { cwd: root } });
  const threadId = (started.result as ThreadSnapshot).id;
  const turn = await a.handle({
    id: 2,
    method: 'turn/start',
    params: { threadId, input: { text: 'first' } },
  });
  const blocked = await b.handle({
    id: 3,
    method: 'turn/start',
    params: { threadId, input: { text: 'second' } },
  });
  expect(blocked.error?.message).toContain('active writer');
  expect(calls).toBe(0);
  const interrupted = await a.handle({
    id: 4,
    method: 'turn/interrupt',
    params: { threadId, turnId: (turn.result as TurnSnapshot).id },
  });
  expect(interrupted.result).toEqual({ interrupted: true });
  expect(firstDrained).toBe(true);
  const resumed = await b.handle({
    id: 5,
    method: 'turn/start',
    params: { threadId, input: { text: 'next' } },
  });
  expect(resumed.error).toBeUndefined();
  await b.waitForIdle();
  expect(calls).toBe(1);
  expect((await store().load(threadId))?.turns.map((turn) => turn.status)).toEqual([
    'interrupted',
    'completed',
  ]);
  expect(await readdir(join(root, 'threads-v1')).catch(() => [])).toEqual([]);
});
it('serves rename and checked snapshot blobs from v2 without legacy writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dc-journal-ui-'));
  roots.push(root);
  const sessions = new SessionManager({ root: join(root, 'sessions') });
  const store = new CanonicalThreadStore(join(root, 'threads-v1'), sessions.root);
  const server = new AppServer({
    store,
    executor: {
      async execute() {
        return {};
      },
    },
  });
  const response = await server.handle({ id: 1, method: 'thread/start', params: { cwd: root } });
  const id = (response.result as ThreadSnapshot).id;
  const file = join(root, 'source.ts');
  await writeFile(file, 'before');
  const snapshot = await sessions.snapshot({
    sessionId: id,
    cwd: root,
    filePath: file,
    reason: 'pre-Edit',
    seq: 1,
  });
  expect((await server.handle({ id: 2, method: 'initialize', params: {} })).result).toMatchObject({
    capabilities: { sessionJournal: true },
  });
  expect(
    (
      await server.handle({
        id: 3,
        method: 'thread/rename',
        params: { threadId: id, title: 'Renamed' },
      })
    ).error,
  ).toBeUndefined();
  expect((await server.handle({ id: 4, method: 'thread/list', params: {} })).result).toMatchObject({
    threads: [{ id, title: 'Renamed' }],
  });
  const result = await server.handle({
    id: 5,
    method: 'session/snapshots',
    params: { threadId: id, path: file },
  });
  expect(result.result).toMatchObject([{ content: 'before', seq: 1 }]);
  await writeFile(snapshot!.blobPath, 'corruption');
  expect(
    (
      await server.handle({
        id: 6,
        method: 'session/snapshots',
        params: { threadId: id, path: file },
      })
    ).error?.message,
  ).toContain('checksum');
  await expect(readFile(join(sessions.root, `${id}.v1.jsonl`))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('recovers an interrupted writer from journal facts without replaying its tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dc-journal-recover-'));
  roots.push(root);
  const sessions = new SessionManager({ root: join(root, 'sessions') });
  const store = new CanonicalThreadStore(join(root, 'threads-v1'), sessions.root);
  const thread: ThreadSnapshot = {
    id: 'interrupted',
    cwd: root,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    turns: [
      {
        id: 'old-turn',
        threadId: 'interrupted',
        status: 'in_progress',
        startedAt: '2026-01-01',
        items: [],
      },
    ],
  };
  await store.save(thread);
  await sessions.record(thread.id, [
    { type: 'turn.started', turnId: 'old-turn', payload: {} },
    {
      type: 'message.observed',
      turnId: 'old-turn',
      payload: {
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Committed before crash' },
            {
              type: 'tool_use',
              id: 'uncertain-call',
              name: 'Write',
              input: { file_path: '/work/file' },
            },
          ],
        },
      },
    },
  ]);
  await store.withWriter(thread.id, async () => {
    const restored = (await store.load(thread.id))!;
    expect(restored.turns[0]?.status).toBe('interrupted');
    expect(restored.turns[0]?.items.some((item) => item.payload.message)).toBe(true);
    const model = (await sessions.load(thread.id))!.messages;
    expect(model.at(-1)?.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'uncertain-call',
      is_error: true,
    });
    await store.save(restored);
    expect((await sessions.load(thread.id))!.messages.at(-1)?.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'uncertain-call',
    });
  });
  expect(
    (await sessions.journal(thread.id).read())?.filter((event) => event.type === 'turn.finished'),
  ).toHaveLength(1);
});

it('keeps snapshot-only legacy sessions readable and refuses unprotected automatic migration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dc-snapshot-legacy-'));
  roots.push(root);
  const { FileThreadStore } = await import('./store.js');
  const legacy = new FileThreadStore(join(root, 'threads-v1'));
  const thread: ThreadSnapshot = {
    id: 'old-snapshot',
    cwd: root,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    turns: [],
  };
  await legacy.save(thread);
  const source = join(legacy.directory, `${thread.id}.json`);
  const before = await readFile(source);
  const store = new CanonicalThreadStore(legacy.directory, join(root, 'sessions'));
  expect(await store.load(thread.id)).toEqual(thread);
  await expect(store.save(thread)).rejects.toThrow('read-only');
  expect(await readFile(source)).toEqual(before);
});

it.each(['after-result', 'during-tool'])(
  'preserves committed effects and repairs the model transcript on cancellation %s',
  async (cancelAt) => {
    const root = await mkdtemp(join(tmpdir(), 'dc-cancel-history-'));
    roots.push(root);
    const sessions = new SessionManager({ root: join(root, 'sessions') });
    const store = new CanonicalThreadStore(join(root, 'threads-v1'), sessions.root);
    let reached!: () => void;
    const ready = new Promise<void>((resolve) => (reached = resolve));
    let toolCalls = 0;
    let steps = 0;
    let resuming = false;
    let resumedHistory: StoredMessage[] = [];
    const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 };
    const host = new RuntimeHost({
      cwd: root,
      disableLedger: true,
      mode: 'bypassPermissions',
      tools: new ToolRegistry([
        {
          name: 'Write',
          definition: { name: 'Write', description: '', inputSchema: {} },
          async execute(_input, { signal }) {
            toolCalls++;
            await writeFile(join(root, 'target'), `effect ${toolCalls}`);
            if (cancelAt === 'during-tool') {
              reached();
              await new Promise<void>((resolve) =>
                signal!.addEventListener('abort', () => resolve(), { once: true }),
              );
            }
            return { content: 'effect committed' };
          },
        },
      ]),
      provider: {
        name: 'fixture',
        async runTurn({ messages, signal }) {
          if (resuming) {
            resumedHistory = messages;
            return { content: [], stopReason: 'end_turn', usage };
          }
          if (steps++ === 0)
            return {
              content: [
                {
                  type: 'tool_use',
                  id: 'write-once',
                  name: 'Write',
                  input: { file_path: join(root, 'target') },
                },
              ],
              stopReason: 'tool_use',
              usage,
            };
          reached();
          return new Promise<never>((_resolve, reject) =>
            signal!.addEventListener(
              'abort',
              () => reject(new DOMException('Stopped', 'AbortError')),
              { once: true },
            ),
          );
        },
      },
    });
    const server = new AppServer({
      store,
      executor: new RuntimeHostExecutor({ createHost: () => host, sessionManager: sessions }),
    });
    try {
      const start = await server.handle({ id: 1, method: 'thread/start', params: { cwd: root } });
      const threadId = (start.result as ThreadSnapshot).id;
      const started = await server.handle({
        id: 2,
        method: 'turn/start',
        params: { threadId, input: { text: 'write it' } },
      });
      await ready;
      const interrupted = await server.handle({
        id: 3,
        method: 'turn/interrupt',
        params: { threadId, turnId: (started.result as TurnSnapshot).id },
      });
      expect(interrupted.result).toEqual({ interrupted: true });
      const transcript = (await sessions.load(threadId))!.messages;
      expect(transcript).toHaveLength(3);
      expect(transcript[1]?.content[0]).toMatchObject({ type: 'tool_use', id: 'write-once' });
      expect(transcript[2]?.content[0]).toMatchObject({
        type: 'tool_result',
        tool_use_id: 'write-once',
        content:
          cancelAt === 'after-result'
            ? 'effect committed'
            : expect.stringContaining('Execution outcome unknown'),
      });
      // A second host can read the terminal projection, and the next real model
      // request gets the repaired result before the newly accepted user input.
      expect(
        (
          await new CanonicalThreadStore(join(root, 'threads-v1'), sessions.root).load(threadId)
        )?.turns[0]?.items.some((item) => item.type === 'tool_result'),
      ).toBe(true);
      resuming = true;
      const resumed = await server.handle({
        id: 4,
        method: 'turn/start',
        params: { threadId, input: { text: 'continue safely' } },
      });
      expect(resumed.error).toBeUndefined();
      await server.waitForIdle();
      expect(resumedHistory.slice(0, 3)).toEqual(transcript);
      expect(resumedHistory[3]?.content[0]).toEqual({ type: 'text', text: 'continue safely' });
      expect(toolCalls).toBe(1);
      expect(await readFile(join(root, 'target'), 'utf8')).toBe('effect 1');
    } finally {
      await server.shutdown();
      await host.close();
    }
  },
);

it('recovers all observed messages after a partial item flush, preserving duplicates per turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dc-partial-projection-'));
  roots.push(root);
  const sessions = new SessionManager({ root: join(root, 'sessions') });
  const store = new CanonicalThreadStore(join(root, 'threads-v1'), sessions.root);
  const repeated: StoredMessage = { role: 'assistant', content: [{ type: 'text', text: 'same' }] };
  const thread: ThreadSnapshot = {
    id: 'partial',
    cwd: root,
    createdAt: 'now',
    updatedAt: 'now',
    turns: [
      {
        id: 'earlier',
        threadId: 'partial',
        status: 'completed',
        startedAt: 'now',
        items: [
          {
            id: 'previous-message',
            type: 'assistant_message',
            payload: { message: repeated },
            completedAt: 'now',
          },
        ],
      },
      {
        id: 'interrupted',
        threadId: 'partial',
        status: 'in_progress',
        startedAt: 'now',
        items: [],
      },
    ],
  };
  await store.save(thread);
  await sessions.record(thread.id, [
    { type: 'turn.started', turnId: 'interrupted', payload: {} },
    { type: 'message.observed', turnId: 'earlier', payload: { message: repeated } },
    ...[repeated, repeated].map((message) => ({
      type: 'message.observed',
      turnId: 'interrupted',
      payload: { message },
    })),
    {
      type: 'message.observed',
      turnId: 'interrupted',
      payload: {
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call', name: 'Write', input: {} }],
        },
      },
    },
    { type: 'tool.intent', turnId: 'interrupted', callId: 'call', payload: { name: 'Write' } },
    {
      type: 'tool.result',
      turnId: 'interrupted',
      callId: 'call',
      payload: { name: 'Write', result: { content: 'durable result', isError: false } },
    },
  ]);
  // Normal server completion saves one item at a time. Crash after the first
  // item: the latest snapshot is newer than every observed message above.
  thread.turns[1]!.items.push({
    id: 'first-published',
    type: 'assistant_message',
    payload: { message: repeated },
    completedAt: 'now',
  });
  await store.save(thread);
  await store.withWriter(thread.id, async () => {});
  const recovered = (await store.load(thread.id))!;
  expect(recovered.turns.map((turn) => turn.status)).toEqual(['completed', 'interrupted']);
  expect(recovered.turns[0]?.items).toHaveLength(1);
  const messages = (await sessions.load(thread.id))!.messages;
  expect(
    messages.filter((message) => JSON.stringify(message) === JSON.stringify(repeated)),
  ).toHaveLength(3);
  expect(messages.at(-1)?.content[0]).toEqual({
    type: 'tool_result',
    tool_use_id: 'call',
    content: 'durable result',
    is_error: false,
  });
  await store.save(recovered);
  await store.withWriter(thread.id, async () => {});
  expect((await sessions.load(thread.id))!.messages).toEqual(messages);
  expect(
    (await sessions.journal(thread.id).read())!.filter(
      (event) => event.type === 'message.observed',
    ),
  ).toHaveLength(4);
});
