import { describe, expect, it } from 'vitest';

import {
  MemoryThreadStore,
  ProtocolInvariantError,
  ProtocolRecorder,
  ProtocolRuntime,
} from './runtime.js';
import type { ProtocolEvent } from './types.js';

function deterministicRuntime(
  store: MemoryThreadStore,
  events: ProtocolEvent[] = [],
): ProtocolRuntime {
  let tick = 0;
  let sequence = 0;
  return new ProtocolRuntime({
    store,
    now: () => `2026-08-01T00:00:0${tick++}.000Z`,
    newId: (prefix) => `${prefix}-${++sequence}`,
    onEvent: (event) => events.push(event),
  });
}

describe('ProtocolRuntime', () => {
  it('advertises the versioned lifecycle capabilities', () => {
    const runtime = deterministicRuntime(new MemoryThreadStore());

    expect(runtime.initialize()).toEqual({
      protocolVersion: 1,
      capabilities: {
        threadResume: true,
        turnInterrupt: true,
        completedItemPersistence: true,
        transientDeltas: true,
        structuredToolEvents: true,
        interactiveRequests: true,
        reviewActions: false,
        reasoningDeltas: false,
        configDiagnostics: false,
        diagnosticExport: false,
        workspaceDiff: false,
      },
    });
  });

  it('persists completed items, keeps deltas transient, and resumes after restart', async () => {
    const store = new MemoryThreadStore();
    const events: ProtocolEvent[] = [];
    const runtime = deterministicRuntime(store, events);
    const thread = await runtime.startThread('/workspace');
    const turn = await runtime.startTurn(thread.id, { text: 'inspect the repository' });
    expect(turn.traceId).toMatch(/^trace-/);
    const assistant = await runtime.appendCompletedItem(thread.id, turn.id, 'assistant_message', {
      text: 'working',
    });

    const savesBeforeDelta = store.saveCount;
    runtime.publishDelta({
      traceId: turn.traceId,
      threadId: thread.id,
      turnId: turn.id,
      itemId: assistant.id,
      delta: '...',
    });
    expect(store.saveCount).toBe(savesBeforeDelta);

    const completed = await runtime.completeTurn(thread.id, turn.id);
    expect(store.saveCount).toBe(4);
    expect(completed.status).toBe('completed');

    const restartedRuntime = deterministicRuntime(store);
    await expect(restartedRuntime.resumeThread(thread.id)).resolves.toEqual({
      ...thread,
      updatedAt: completed.completedAt,
      turns: [completed],
    });
    expect(events.map((event) => event.type)).toEqual([
      'thread.started',
      'turn.started',
      'item.completed',
      'item.completed',
      'item.delta',
      'turn.completed',
    ]);
    expect(
      events
        .filter((event) => event.type !== 'thread.started')
        .every((event) => event.traceId === turn.traceId),
    ).toBe(true);
  });

  it('allows only one active turn per thread', async () => {
    const runtime = deterministicRuntime(new MemoryThreadStore());
    const thread = await runtime.startThread('/workspace');
    await runtime.startTurn(thread.id, { text: 'first' });

    await expect(runtime.startTurn(thread.id, { text: 'second' })).rejects.toThrow(
      new ProtocolInvariantError(`Thread ${thread.id} already has an active turn`),
    );
  });

  it('makes terminal transitions idempotent and rejects late items', async () => {
    const store = new MemoryThreadStore();
    const events: ProtocolEvent[] = [];
    const runtime = deterministicRuntime(store, events);
    const thread = await runtime.startThread('/workspace');
    const turn = await runtime.startTurn(thread.id, { text: 'stop me' });

    const interrupted = await runtime.interruptTurn(thread.id, turn.id);
    const savesAfterInterrupt = store.saveCount;
    await expect(runtime.interruptTurn(thread.id, turn.id)).resolves.toEqual(interrupted);
    await expect(runtime.completeTurn(thread.id, turn.id)).resolves.toEqual(interrupted);
    expect(store.saveCount).toBe(savesAfterInterrupt);
    expect(events.filter((event) => event.type === 'turn.interrupted')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn.completed')).toHaveLength(0);
    await expect(
      runtime.appendCompletedItem(thread.id, turn.id, 'assistant_message', { text: 'late' }),
    ).rejects.toThrow(`Cannot append to terminal turn ${turn.id}`);
  });

  it('records and replays only durable events', async () => {
    const recorder = new ProtocolRecorder();
    const runtime = new ProtocolRuntime({
      store: new MemoryThreadStore(),
      now: () => '2026-08-01T00:00:00.000Z',
      newId: (prefix) => `${prefix}-1`,
      onEvent: (event) => recorder.record(event),
    });
    const thread = await runtime.startThread('/workspace');
    const turn = await runtime.startTurn(thread.id, { text: 'hello' });
    runtime.publishDelta({
      threadId: thread.id,
      turnId: turn.id,
      itemId: 'item-streaming',
      delta: 'hel',
    });
    recorder.record({
      type: 'tool.started',
      threadId: thread.id,
      turnId: turn.id,
      itemId: 'tool-1',
      name: 'Read',
      input: { file_path: 'README.md' },
    });
    recorder.record({
      type: 'approval.requested',
      threadId: thread.id,
      turnId: turn.id,
      requestId: 'request-1',
      toolName: 'Bash',
      reason: 'Run command?',
    });
    await runtime.completeTurn(thread.id, turn.id);

    const replayed: ProtocolEvent[] = [];
    recorder.replay((event) => replayed.push(event));
    expect(replayed).toEqual(recorder.snapshot());
    expect(replayed.map((event) => event.type)).toEqual([
      'thread.started',
      'turn.started',
      'item.completed',
      'turn.completed',
    ]);
  });
});
