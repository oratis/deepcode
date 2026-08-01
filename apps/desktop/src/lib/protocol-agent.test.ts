import type {
  ConfigDiagnosticsResult,
  InitializeResult,
  ProtocolEvent,
  ProtocolMethod,
  ThreadSnapshot,
  TurnSnapshot,
} from '@deepcode/protocol';
import { describe, expect, it, vi } from 'vitest';

import { DesktopProtocolAgent, type ProtocolTransport } from './protocol-agent.js';

class FakeTransport implements ProtocolTransport {
  handler?: (event: ProtocolEvent) => void;
  requests: Array<{ method: ProtocolMethod; params: Record<string, unknown> }> = [];

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
      },
    };
  }

  subscribe(handler: (event: ProtocolEvent) => void): () => void {
    this.handler = handler;
    return () => {
      this.handler = undefined;
    };
  }

  async request<T>(method: ProtocolMethod, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ method, params });
    if (method === 'thread/start') return thread as T;
    if (method === 'thread/resume') return thread as T;
    if (method === 'turn/start') return turn as T;
    if (method === 'turn/interrupt') return { interrupted: true } as T;
    if (method === 'config/diagnostics') return diagnostics as T;
    return { accepted: true } as T;
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

const thread: ThreadSnapshot = {
  id: 'thread-1',
  cwd: '/workspace',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  turns: [],
};

const turn: TurnSnapshot = {
  id: 'turn-1',
  threadId: thread.id,
  status: 'in_progress',
  startedAt: '2026-08-01T00:00:01.000Z',
  items: [],
};

describe('DesktopProtocolAgent', () => {
  it('reads value-free diagnostics from the shared app-server', async () => {
    const transport = new FakeTransport();
    const agent = new DesktopProtocolAgent(transport, () => undefined);

    await expect(agent.diagnostics('/workspace')).resolves.toEqual(diagnostics);
    expect(transport.requests).toEqual([
      { method: 'config/diagnostics', params: { cwd: '/workspace' } },
    ]);
  });

  it('buffers fast server events until turn/start returns, then projects them in order', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const events: unknown[] = [];
    const agent = new DesktopProtocolAgent(transport, (event) => events.push(event));
    transport.request = async <T>(method: ProtocolMethod, params = {}) => {
      transport.requests.push({ method, params });
      if (method === 'thread/start') return thread as T;
      if (method === 'turn/start') {
        transport.handler?.({ type: 'turn.started', threadId: thread.id, turn });
        transport.handler?.({
          type: 'item.delta',
          threadId: thread.id,
          turnId: turn.id,
          itemId: 'assistant',
          delta: 'done',
        });
        transport.handler?.({
          type: 'turn.completed',
          threadId: thread.id,
          turn: { ...turn, status: 'completed' },
        });
        return turn as T;
      }
      return { accepted: true } as T;
    };

    await expect(
      agent.start({ userMessage: 'hello', cwd: '/workspace', effort: 'high' }),
    ).resolves.toEqual({ turnId: turn.id, threadId: thread.id });
    expect(events).toEqual([]);
    await vi.runAllTimersAsync();

    expect(events).toEqual([
      expect.objectContaining({ type: 'text_delta', text: 'done' }),
      expect.objectContaining({ kind: 'turn_done', stopReason: 'end_turn' }),
    ]);
    vi.useRealTimers();
  });

  it('binds approval responses to the request context and maps tool activity', async () => {
    const transport = new FakeTransport();
    const events: unknown[] = [];
    const agent = new DesktopProtocolAgent(transport, (event) => events.push(event));
    await agent.resume(thread.id);
    await agent.start({ userMessage: 'change it' });

    transport.handler?.({
      type: 'tool.started',
      threadId: thread.id,
      turnId: turn.id,
      itemId: 'tool-1',
      name: 'Edit',
      input: { file_path: 'a.ts' },
    });
    transport.handler?.({
      type: 'approval.requested',
      threadId: thread.id,
      turnId: turn.id,
      requestId: 'request-1',
      toolName: 'Edit',
      reason: 'write needs approval',
    });
    await agent.approve('request-1', 'always');

    expect(events).toEqual([
      expect.objectContaining({ type: 'tool_use', id: 'tool-1', name: 'Edit' }),
      expect.objectContaining({ type: 'permission_request', requestId: 'request-1' }),
    ]);
    expect(transport.requests.at(-1)).toEqual({
      method: 'approval/respond',
      params: {
        threadId: thread.id,
        turnId: turn.id,
        requestId: 'request-1',
        decision: 'always',
      },
    });
    await expect(agent.approve('request-1', 'allow')).rejects.toThrow('not found');
  });

  it('interrupts only known active turns', async () => {
    const transport = new FakeTransport();
    const agent = new DesktopProtocolAgent(transport, () => undefined);
    await agent.resume(thread.id);
    await agent.start({ userMessage: 'wait' });

    await expect(agent.abort(turn.id)).resolves.toBe(true);
    await expect(agent.abort('unknown')).resolves.toBe(false);
    expect(transport.requests.at(-1)).toEqual({
      method: 'turn/interrupt',
      params: { threadId: thread.id, turnId: turn.id },
    });
  });

  it('drops late events after clearing an active thread', async () => {
    const transport = new FakeTransport();
    const events: unknown[] = [];
    const agent = new DesktopProtocolAgent(transport, (event) => events.push(event));
    await agent.resume(thread.id);
    await agent.start({ userMessage: 'wait' });

    agent.clear();
    transport.handler?.({
      type: 'item.delta',
      threadId: thread.id,
      turnId: turn.id,
      itemId: 'assistant',
      delta: 'too late',
    });

    expect(events).toEqual([]);
    expect(transport.requests.at(-1)).toEqual({
      method: 'turn/interrupt',
      params: { threadId: thread.id, turnId: turn.id },
    });
  });
});
