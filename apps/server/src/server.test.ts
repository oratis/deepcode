import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProtocolEvent, ProtocolRequest } from '@deepcode/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppServer, type TurnExecutor } from './server.js';
import { FileThreadStore } from './store.js';

let temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots = [];
});

function request(
  id: number,
  method: ProtocolRequest['method'],
  params: Record<string, unknown> = {},
): ProtocolRequest {
  return { id, method, params };
}

function deterministicOptions() {
  let sequence = 0;
  let tick = 0;
  return {
    now: () => `2026-08-01T00:00:0${tick++}.000Z`,
    newId: (prefix: 'thread' | 'turn' | 'item') => `${prefix}-${++sequence}`,
  };
}

describe('AppServer', () => {
  it('routes initialization and thread lifecycle requests', async () => {
    const server = new AppServer({
      executor: { execute: async () => ({}) },
      ...deterministicOptions(),
    });

    await expect(server.handle(request(1, 'initialize'))).resolves.toEqual({
      id: 1,
      result: expect.objectContaining({ protocolVersion: 1 }),
    });
    const started = await server.handle(request(2, 'thread/start', { cwd: '/workspace' }));
    expect(started).toEqual({
      id: 2,
      result: expect.objectContaining({ id: 'thread-1', cwd: '/workspace' }),
    });
    await expect(
      server.handle(request(3, 'thread/read', { threadId: 'thread-1' })),
    ).resolves.toEqual(started.id === 2 ? { id: 3, result: started.result } : undefined);
  });

  it('persists completed items and terminal state while publishing deltas transiently', async () => {
    const events: ProtocolEvent[] = [];
    const executor: TurnExecutor = {
      execute: async ({ publishDelta, publishToolStarted, publishToolCompleted, publishUsage }) => {
        publishDelta('assistant-stream', 'hel');
        publishToolStarted('tool-1', 'Read', { file_path: 'README.md' });
        publishToolCompleted('tool-1', { content: 'contents' });
        publishUsage({ inputTokens: 1, outputTokens: 2 });
        return {
          items: [{ type: 'assistant_message', payload: { text: 'hello' } }],
        };
      },
    };
    const server = new AppServer({
      executor,
      onEvent: (event) => events.push(event),
      ...deterministicOptions(),
    });
    await server.handle(request(1, 'thread/start', { cwd: '/workspace' }));
    const started = await server.handle(
      request(2, 'turn/start', { threadId: 'thread-1', input: { text: 'hello' } }),
    );
    expect(started).toEqual({
      id: 2,
      result: expect.objectContaining({ id: 'turn-3', status: 'in_progress' }),
    });
    await server.waitForIdle();

    const read = await server.handle(request(3, 'thread/read', { threadId: 'thread-1' }));
    expect(read).toEqual({
      id: 3,
      result: expect.objectContaining({
        turns: [
          expect.objectContaining({
            status: 'completed',
            items: [
              expect.objectContaining({ type: 'user_message' }),
              expect.objectContaining({ type: 'assistant_message', payload: { text: 'hello' } }),
            ],
          }),
        ],
      }),
    });
    expect(events.map((event) => event.type)).toContain('item.delta');
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['tool.started', 'tool.completed', 'usage.updated']),
    );
    expect((read.result as { turns: Array<{ items: unknown[] }> }).turns[0]?.items).toHaveLength(2);
  });

  it('interrupts the actual executor and emits one terminal event', async () => {
    const events: ProtocolEvent[] = [];
    let observedAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      observedAbort = resolve;
    });
    const executor: TurnExecutor = {
      execute: async ({ signal }) => {
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              observedAbort();
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      },
    };
    const server = new AppServer({
      executor,
      onEvent: (event) => events.push(event),
      ...deterministicOptions(),
    });
    await server.handle(request(1, 'thread/start', { cwd: '/workspace' }));
    await server.handle(
      request(2, 'turn/start', { threadId: 'thread-1', input: { text: 'wait' } }),
    );

    await expect(
      server.handle(request(3, 'turn/interrupt', { threadId: 'thread-1', turnId: 'turn-3' })),
    ).resolves.toEqual({ id: 3, result: { interrupted: true } });
    await aborted;
    await server.waitForIdle();
    expect(events.filter((event) => event.type === 'turn.interrupted')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn.completed')).toHaveLength(0);
  });

  it('round-trips approval and user-input requests through the active turn', async () => {
    const events: ProtocolEvent[] = [];
    const responses: string[] = [];
    const executor: TurnExecutor = {
      execute: async ({ requestApproval, requestUserInput }) => {
        responses.push(await requestApproval('Bash', 'Run tests?'));
        responses.push(
          await requestUserInput({
            question: 'Choose scope',
            options: [{ label: 'All', description: 'Run every test' }],
          }),
        );
        return {};
      },
    };
    const server = new AppServer({ executor, onEvent: (event) => events.push(event) });
    const thread = await server.handle(request(1, 'thread/start', { cwd: '/workspace' }));
    const threadId = (thread.result as { id: string }).id;
    const started = await server.handle(
      request(2, 'turn/start', { threadId, input: { text: 'test' } }),
    );
    const turnId = (started.result as { id: string }).id;
    const approval = events.find((event) => event.type === 'approval.requested');
    expect(approval).toEqual(
      expect.objectContaining({ type: 'approval.requested', threadId, turnId, toolName: 'Bash' }),
    );

    await expect(
      server.handle(
        request(3, 'approval/respond', {
          threadId,
          turnId,
          requestId: approval?.type === 'approval.requested' ? approval.requestId : '',
          decision: 'allow',
        }),
      ),
    ).resolves.toEqual({ id: 3, result: { accepted: true } });
    await Promise.resolve();

    const question = events.find((event) => event.type === 'user-input.requested');
    expect(question).toEqual(
      expect.objectContaining({ type: 'user-input.requested', threadId, turnId }),
    );
    await server.handle(
      request(4, 'user-input/respond', {
        threadId,
        turnId,
        requestId: question?.type === 'user-input.requested' ? question.requestId : '',
        answer: 'All',
      }),
    );
    await server.waitForIdle();

    expect(responses).toEqual(['allow', 'All']);
    expect(events.filter((event) => event.type === 'turn.completed')).toHaveLength(1);
    await expect(
      server.handle(
        request(5, 'approval/respond', {
          threadId,
          turnId,
          requestId: approval?.type === 'approval.requested' ? approval.requestId : '',
          decision: 'allow',
        }),
      ),
    ).resolves.toEqual({
      id: 5,
      error: expect.objectContaining({ code: 'invalid_request' }),
    });
  });

  it('releases a pending interaction when its turn is interrupted', async () => {
    let decision: string | undefined;
    const executor: TurnExecutor = {
      execute: async ({ requestApproval }) => {
        decision = await requestApproval('Bash', 'Run forever?');
        return {};
      },
    };
    const server = new AppServer({ executor });
    const thread = await server.handle(request(1, 'thread/start', { cwd: '/workspace' }));
    const threadId = (thread.result as { id: string }).id;
    const started = await server.handle(
      request(2, 'turn/start', { threadId, input: { text: 'wait' } }),
    );
    const turnId = (started.result as { id: string }).id;

    await server.handle(request(3, 'turn/interrupt', { threadId, turnId }));
    await server.waitForIdle();

    expect(decision).toBe('deny');
    const read = await server.handle(request(4, 'thread/read', { threadId }));
    expect(read.result).toEqual(
      expect.objectContaining({ turns: [expect.objectContaining({ status: 'interrupted' })] }),
    );
  });

  it('marks an orphaned active turn interrupted when a new process resumes it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepcode-app-server-'));
    temporaryRoots.push(root);
    const store = new FileThreadStore(root);
    const first = new AppServer({
      store,
      executor: { execute: () => new Promise(() => {}) },
      ...deterministicOptions(),
    });
    await first.handle(request(1, 'thread/start', { cwd: '/workspace' }));
    await first.handle(
      request(2, 'turn/start', { threadId: 'thread-1', input: { text: 'unfinished' } }),
    );

    const restarted = new AppServer({ store, executor: { execute: async () => ({}) } });
    const response = await restarted.handle(request(3, 'thread/resume', { threadId: 'thread-1' }));
    expect(response).toEqual({
      id: 3,
      result: expect.objectContaining({
        turns: [expect.objectContaining({ status: 'interrupted' })],
      }),
    });
  });

  it('returns structured errors for invalid requests', async () => {
    const server = new AppServer({ executor: { execute: async () => ({}) } });
    await expect(server.handle(request(1, 'thread/start'))).resolves.toEqual({
      id: 1,
      error: { code: 'invalid_request', message: 'cwd is required' },
    });
    await expect(
      server.handle(request(2, 'thread/read', { threadId: '../credentials' })),
    ).resolves.toEqual({
      id: 2,
      error: { code: 'invalid_request', message: 'threadId is invalid' },
    });
  });
});
