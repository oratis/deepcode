import type {
  InitializeResult,
  ProtocolEvent,
  ProtocolMethod,
  ProtocolRequest,
  ThreadSnapshot,
  TurnSnapshot,
} from '@deepcode/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { __test, handleMessage, type LspMessage, type SendFn } from './handler.js';

const capabilities: InitializeResult = {
  protocolVersion: 1,
  capabilities: {
    threadResume: true,
    turnInterrupt: true,
    completedItemPersistence: true,
    transientDeltas: true,
    structuredToolEvents: true,
    interactiveRequests: true,
  },
};

class FakeClient {
  subscribers = new Set<(event: ProtocolEvent) => void>();
  requests: ProtocolRequest[] = [];
  thread: ThreadSnapshot = {
    id: 'thread-1',
    cwd: '/tmp/workspace',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    turns: [],
  };
  turn: TurnSnapshot = {
    id: 'turn-1',
    threadId: 'thread-1',
    status: 'in_progress',
    startedAt: '2026-08-01T00:00:01.000Z',
    items: [],
  };
  completeTurns = true;
  closed = 0;

  async connect() {
    return capabilities;
  }

  subscribe(handler: (event: ProtocolEvent) => void) {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  async request<T>(method: ProtocolMethod, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ id: this.requests.length + 1, method, params });
    switch (method) {
      case 'thread/start':
        this.emit({ type: 'thread.started', thread: this.thread });
        return this.thread as T;
      case 'thread/read':
      case 'thread/resume':
        return this.thread as T;
      case 'turn/start': {
        // Deliberately precedes the response to exercise the LSP fast-turn queue.
        this.emit({ type: 'turn.started', threadId: this.thread.id, turn: this.turn });
        queueMicrotask(() => {
          this.emit({
            type: 'item.delta',
            threadId: this.thread.id,
            turnId: this.turn.id,
            itemId: 'assistant',
            delta: 'hello',
          });
          if (this.completeTurns) {
            this.turn = {
              ...this.turn,
              status: 'completed',
              completedAt: '2026-08-01T00:00:02.000Z',
            };
            this.emit({ type: 'turn.completed', threadId: this.thread.id, turn: this.turn });
          }
        });
        return this.turn as T;
      }
      case 'turn/interrupt':
        this.turn = {
          ...this.turn,
          status: 'interrupted',
          completedAt: '2026-08-01T00:00:02.000Z',
        };
        this.emit({ type: 'turn.interrupted', threadId: this.thread.id, turn: this.turn });
        return { interrupted: true } as T;
      case 'approval/respond':
      case 'user-input/respond':
        return { accepted: true } as T;
      default:
        throw new Error(`Unexpected method: ${method}`);
    }
  }

  async close() {
    this.closed++;
  }

  emit(event: ProtocolEvent) {
    for (const subscriber of this.subscribers) subscriber(event);
  }
}

afterEach(async () => {
  await __test.reset();
});

describe('handleMessage — initialize', () => {
  it('advertises lifecycle and interactive protocol commands', async () => {
    const out: LspMessage[] = [];
    await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { rootUri: 'file:///tmp/x' } },
      (message) => out.push(message),
    );
    const result = out[0]!.result as {
      capabilities: { executeCommandProvider: { commands: string[] } };
      serverInfo: { name: string };
    };
    expect(result.serverInfo.name).toBe('deepcode-lsp');
    expect(result.capabilities.executeCommandProvider.commands).toEqual(
      expect.arrayContaining([
        'deepcode.runAgent',
        'deepcode.abort',
        'deepcode.readThread',
        'deepcode.resumeThread',
        'deepcode.respondApproval',
        'deepcode.respondUserInput',
      ]),
    );
  });
});

describe('handleMessage — protocol commands', () => {
  it('starts a canonical thread and emits native protocol events in order', async () => {
    const client = new FakeClient();
    __test.setClientFactory(() => client);
    const out: LspMessage[] = [];

    await execute(2, 'deepcode.runAgent', { prompt: 'hi', effort: 'high' }, (message) =>
      out.push(message),
    );
    await Promise.resolve();

    const reply = out.find((message) => message.id === 2);
    expect(reply?.result).toEqual({ threadId: 'thread-1', turnId: 'turn-1' });
    const events = out
      .filter((message) => message.method === 'deepcode/protocolEvent')
      .map((message) => (message.params as ProtocolEvent).type);
    expect(events).toEqual(['thread.started', 'turn.started', 'item.delta', 'turn.completed']);
    expect(client.requests.map((request) => request.method)).toEqual([
      'thread/start',
      'turn/start',
    ]);
    expect(client.requests[1]?.params.input).toEqual({ text: 'hi', effort: 'high' });
  });

  it('interrupts the app-server turn instead of a local controller', async () => {
    const client = new FakeClient();
    client.completeTurns = false;
    __test.setClientFactory(() => client);
    const out: LspMessage[] = [];
    const send = (message: LspMessage) => out.push(message);

    await execute(3, 'deepcode.runAgent', { prompt: 'wait' }, send);
    await execute(4, 'deepcode.abort', { turnId: 'turn-1' }, send);

    expect(out.find((message) => message.id === 4)?.result).toEqual({ aborted: true });
    expect(client.requests.at(-1)).toMatchObject({
      method: 'turn/interrupt',
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    });
    expect(
      out.some(
        (message) =>
          message.method === 'deepcode/protocolEvent' &&
          (message.params as ProtocolEvent).type === 'turn.interrupted',
      ),
    ).toBe(true);
  });

  it('binds approval and user-input responses to the active thread and turn', async () => {
    const client = new FakeClient();
    client.completeTurns = false;
    __test.setClientFactory(() => client);
    const out: LspMessage[] = [];
    const send = (message: LspMessage) => out.push(message);

    await execute(5, 'deepcode.runAgent', { prompt: 'edit' }, send);
    client.emit({
      type: 'approval.requested',
      threadId: 'thread-1',
      turnId: 'turn-1',
      requestId: 'approval-1',
      toolName: 'Edit',
      reason: 'write',
    });
    await execute(
      6,
      'deepcode.respondApproval',
      { turnId: 'turn-1', requestId: 'approval-1', decision: 'allow' },
      send,
    );
    await execute(
      7,
      'deepcode.respondUserInput',
      { turnId: 'turn-1', requestId: 'question-1', answer: 'All' },
      send,
    );

    expect(client.requests.slice(-2)).toEqual([
      expect.objectContaining({
        method: 'approval/respond',
        params: expect.objectContaining({ threadId: 'thread-1', requestId: 'approval-1' }),
      }),
      expect.objectContaining({
        method: 'user-input/respond',
        params: expect.objectContaining({ threadId: 'thread-1', answer: 'All' }),
      }),
    ]);
  });

  it('reads and resumes protocol snapshots', async () => {
    const client = new FakeClient();
    __test.setClientFactory(() => client);
    const out: LspMessage[] = [];
    const send = (message: LspMessage) => out.push(message);

    await execute(8, 'deepcode.resumeThread', { threadId: 'thread-1' }, send);
    await execute(9, 'deepcode.readThread', { threadId: 'thread-1' }, send);

    expect(out.find((message) => message.id === 8)?.result).toMatchObject({ id: 'thread-1' });
    expect(out.find((message) => message.id === 9)?.result).toMatchObject({ id: 'thread-1' });
    expect(client.requests.map((request) => request.method)).toEqual([
      'thread/resume',
      'thread/read',
    ]);
  });

  it('rejects missing prompts and unknown turns', async () => {
    const client = new FakeClient();
    __test.setClientFactory(() => client);
    const out: LspMessage[] = [];
    const send = (message: LspMessage) => out.push(message);

    await execute(10, 'deepcode.runAgent', {}, send);
    await execute(11, 'deepcode.abort', { turnId: 'unknown' }, send);

    expect(out.find((message) => message.id === 10)?.error?.message).toMatch(/prompt is required/);
    expect(out.find((message) => message.id === 11)?.result).toEqual({ aborted: false });
  });
});

describe('handleMessage — lifecycle', () => {
  it('closes the app-server client on shutdown', async () => {
    const client = new FakeClient();
    __test.setClientFactory(() => client);
    const out: LspMessage[] = [];
    await execute(12, 'deepcode.resumeThread', { threadId: 'thread-1' }, (message) =>
      out.push(message),
    );

    await handleMessage({ jsonrpc: '2.0', id: 13, method: 'shutdown' }, (message) =>
      out.push(message),
    );

    expect(client.closed).toBe(1);
    expect(out.find((message) => message.id === 13)?.result).toBeNull();
  });

  it('silently drops unknown notifications and reports unsupported requests', async () => {
    const out: LspMessage[] = [];
    await handleMessage({ jsonrpc: '2.0', method: 'unknown/notif' }, (message) =>
      out.push(message),
    );
    expect(out).toHaveLength(0);

    await handleMessage({ jsonrpc: '2.0', id: 14, method: 'unknown/method' }, (message) =>
      out.push(message),
    );
    expect(out[0]?.error?.message).toMatch(/Method not supported/);
  });
});

async function execute(id: number, command: string, args: unknown, send: SendFn) {
  await handleMessage(
    {
      jsonrpc: '2.0',
      id,
      method: 'workspace/executeCommand',
      params: { command, arguments: [args] },
    },
    send,
  );
}
