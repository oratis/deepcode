import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionManager, writeMeta } from '@deepcode/core/sessions';
import type { ThreadSnapshot } from '@deepcode/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { CanonicalThreadStore } from './store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'deepcode-thread-store-'));
  roots.push(root);
  const sessionsRoot = join(root, 'sessions');
  return {
    store: new CanonicalThreadStore(join(root, 'threads-v1'), sessionsRoot),
    sessions: new SessionManager({ root: sessionsRoot }),
  };
}

describe('CanonicalThreadStore', () => {
  it('materializes protocol history into the canonical session index', async () => {
    const { store, sessions } = await fixture();
    const thread: ThreadSnapshot = {
      id: 'thread-1',
      cwd: '/workspace',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:02.000Z',
      turns: [
        {
          id: 'turn-1',
          threadId: 'thread-1',
          status: 'completed',
          startedAt: '2026-08-01T00:00:01.000Z',
          completedAt: '2026-08-01T00:00:02.000Z',
          items: [
            {
              id: 'item-1',
              type: 'user_message',
              payload: { text: 'Review the repository', model: 'deepseek-chat' },
              completedAt: '2026-08-01T00:00:01.000Z',
            },
            {
              id: 'item-2',
              type: 'assistant_message',
              payload: {
                message: {
                  role: 'assistant',
                  content: [{ type: 'text', text: 'Done' }],
                },
              },
              completedAt: '2026-08-01T00:00:02.000Z',
            },
          ],
        },
      ],
    };

    await store.save(thread);

    await expect(sessions.list()).resolves.toEqual([
      expect.objectContaining({
        id: thread.id,
        cwd: '/workspace',
        title: 'Review the repository',
        model: 'deepseek-chat',
      }),
    ]);
    await expect(sessions.load(thread.id)).resolves.toEqual({
      meta: expect.objectContaining({ id: thread.id }),
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Review the repository' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      ],
    });

    const current = await sessions.load(thread.id);
    await writeMeta(sessions.root, { ...current!.meta, title: 'Renamed by user' });
    await store.save({ ...thread, updatedAt: '2026-08-01T00:00:03.000Z' });
    await expect(sessions.load(thread.id)).resolves.toEqual({
      meta: expect.objectContaining({ title: 'Renamed by user' }),
      messages: expect.any(Array),
    });
  });

  it('lazily imports a canonical or legacy session as a resumable protocol thread', async () => {
    const { store, sessions } = await fixture();
    const meta = await sessions.create('/legacy', { title: 'Existing chat' });
    await sessions.append(meta.id, {
      role: 'user',
      content: [{ type: 'text', text: 'Continue this' }],
    });
    await sessions.append(meta.id, {
      role: 'assistant',
      content: [{ type: 'text', text: 'Ready' }],
    });

    const imported = await store.load(meta.id);

    expect(imported).toEqual(
      expect.objectContaining({
        id: meta.id,
        cwd: '/legacy',
        turns: [
          expect.objectContaining({
            status: 'completed',
            items: [
              expect.objectContaining({ type: 'user_message' }),
              expect.objectContaining({ type: 'assistant_message' }),
            ],
          }),
        ],
      }),
    );
    await expect(store.load(meta.id)).resolves.toEqual(imported);
  });
});

describe('CanonicalThreadStore.delete', () => {
  const thread = (id: string): ThreadSnapshot => ({
    id,
    cwd: '/workspace',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:02.000Z',
    turns: [
      {
        id: `${id}-turn-1`,
        threadId: id,
        status: 'completed',
        startedAt: '2026-08-01T00:00:01.000Z',
        completedAt: '2026-08-01T00:00:02.000Z',
        items: [
          {
            id: `${id}-item-1`,
            type: 'user_message',
            payload: { text: 'hello', model: 'deepseek-chat' },
            completedAt: '2026-08-01T00:00:01.000Z',
          },
        ],
      },
    ],
  });

  it('removes both representations, so the thread cannot come back', async () => {
    // The snapshot and the canonical session projection share an id and are two
    // views of one thing. `list` reads both, so removing one and leaving the
    // other means the row reappears on the next refresh — as an empty session
    // that cannot be opened.
    const { store, sessions } = await fixture();
    await store.save(thread('thread-del'));

    expect(await store.load('thread-del')).not.toBeNull();
    expect(await sessions.list()).toHaveLength(1);

    await store.delete('thread-del');

    expect(await store.load('thread-del')).toBeNull();
    expect(await sessions.list()).toHaveLength(0);
    expect(await store.list()).toHaveLength(0);
  });

  it('leaves other threads alone', async () => {
    const { store } = await fixture();
    await store.save(thread('thread-keep'));
    await store.save(thread('thread-drop'));

    await store.delete('thread-drop');

    expect((await store.list()).map((t) => t.id)).toEqual(['thread-keep']);
  });
});
