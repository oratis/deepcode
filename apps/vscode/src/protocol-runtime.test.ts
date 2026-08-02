import type {
  ConfigDiagnosticsResult,
  InitializeResult,
  ProtocolEvent,
  ProtocolMethod,
  ProtocolRequest,
  ThreadSnapshot,
  TurnSnapshot,
} from '@deepcode/protocol';
import { describe, expect, it, vi } from 'vitest';

import { EditorProtocolRuntime } from './protocol-runtime.js';

class FakeClient {
  handlers = new Set<(event: ProtocolEvent) => void>();
  requests: ProtocolRequest[] = [];
  thread: ThreadSnapshot = {
    id: 'thread-1',
    cwd: '/workspace',
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

  async connect(): Promise<InitializeResult> {
    return {
      protocolVersion: 1,
      capabilities: {
        threadResume: true,
        turnInterrupt: true,
        completedItemPersistence: true,
        transientDeltas: true,
        structuredToolEvents: true,
        interactiveRequests: true,
        configDiagnostics: true,
        diagnosticExport: true,
      },
    };
  }

  subscribe(handler: (event: ProtocolEvent) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async request<T>(method: ProtocolMethod, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ id: this.requests.length + 1, method, params });
    if (method === 'thread/start' || method === 'thread/read' || method === 'thread/resume') {
      return this.thread as T;
    }
    if (method === 'turn/start') {
      this.emit({ type: 'turn.started', threadId: this.thread.id, turn: this.turn });
      this.emit({
        type: 'item.delta',
        threadId: this.thread.id,
        turnId: this.turn.id,
        itemId: 'assistant',
        delta: 'hello',
      });
      return this.turn as T;
    }
    if (method === 'turn/interrupt') return { interrupted: true } as T;
    if (method === 'config/diagnostics') return diagnostics as T;
    return { accepted: true } as T;
  }

  async close() {}

  emit(event: ProtocolEvent) {
    for (const handler of this.handlers) handler(event);
  }
}

const diagnostics: ConfigDiagnosticsResult = {
  cwd: '/workspace',
  trustStatus: 'untrusted',
  layers: [],
  provenance: {},
  gated: ['permissions'],
  issues: [],
};

describe('EditorProtocolRuntime', () => {
  it('reads configuration diagnostics from the app-server for the editor workspace', async () => {
    const client = new FakeClient();
    const runtime = new EditorProtocolRuntime(client, () => '/workspace');

    await expect(runtime.diagnostics()).resolves.toEqual(diagnostics);
    expect(client.requests).toEqual([
      expect.objectContaining({ method: 'config/diagnostics', params: { cwd: '/workspace' } }),
    ]);
  });

  it('honors diagnostics capability negotiation', async () => {
    const client = new FakeClient();
    client.connect = async () => {
      const initialized = await new FakeClient().connect();
      return {
        ...initialized,
        capabilities: { ...initialized.capabilities, configDiagnostics: false },
      };
    };
    const runtime = new EditorProtocolRuntime(client, () => '/workspace');

    await expect(runtime.diagnostics()).rejects.toThrow(/does not support/);
    expect(client.requests).toEqual([]);
  });

  it('buffers fast turn events and reuses the canonical thread', async () => {
    const client = new FakeClient();
    const runtime = new EditorProtocolRuntime(client, () => '/workspace');
    const events: ProtocolEvent[] = [];

    await expect(runtime.start({ text: 'hello' }, (event) => events.push(event))).resolves.toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
    expect(events.map((event) => event.type)).toEqual(['turn.started', 'item.delta']);

    await runtime.start({ text: 'again' }, () => undefined);
    expect(client.requests.map((request) => request.method)).toEqual([
      'thread/start',
      'turn/start',
      'thread/read',
      'turn/start',
    ]);
  });

  it('routes approval, user input, and interruption with server ids', async () => {
    const client = new FakeClient();
    const runtime = new EditorProtocolRuntime(client, () => '/workspace');
    await runtime.start({ text: 'edit' }, () => undefined);

    await expect(runtime.approve('turn-1', 'approval-1', 'allow')).resolves.toEqual({
      accepted: true,
    });
    await expect(runtime.answer('turn-1', 'question-1', 'All')).resolves.toEqual({
      accepted: true,
    });
    await expect(runtime.interrupt('turn-1')).resolves.toBe(true);

    expect(client.requests.slice(-3)).toEqual([
      expect.objectContaining({
        method: 'approval/respond',
        params: expect.objectContaining({ threadId: 'thread-1', requestId: 'approval-1' }),
      }),
      expect.objectContaining({
        method: 'user-input/respond',
        params: expect.objectContaining({ threadId: 'thread-1', answer: 'All' }),
      }),
      expect.objectContaining({ method: 'turn/interrupt' }),
    ]);
  });

  it('drops routing state on terminal events and closes the client', async () => {
    const client = new FakeClient();
    client.close = vi.fn();
    const runtime = new EditorProtocolRuntime(client, () => '/workspace');
    const handler = vi.fn();
    await runtime.start({ text: 'done' }, handler);
    client.turn = {
      ...client.turn,
      status: 'completed',
      completedAt: '2026-08-01T00:00:02.000Z',
    };
    client.emit({ type: 'turn.completed', threadId: 'thread-1', turn: client.turn });

    await expect(runtime.interrupt('turn-1')).resolves.toBe(false);
    await runtime.close();
    expect(client.close).toHaveBeenCalledOnce();
  });
});
