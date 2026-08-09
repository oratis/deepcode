import type {
  ConfigDiagnosticsResult,
  InitializeResult,
  ProtocolEvent,
  ProtocolMethod,
  ReviewFindingPayload,
  ThreadSnapshot,
  TurnSnapshot,
  WorkspaceDiffResult,
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
        reviewActions: true,
        reasoningDeltas: true,
        threadManagement: true,
        runtimeCapabilities: true,
        configDiagnostics: true,
        diagnosticExport: true,
        workspaceDiff: true,
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
    if (method === 'review/apply') return turn as T;
    if (method === 'review/revert') return turn as T;
    if (method === 'turn/interrupt') return { interrupted: true } as T;
    if (method === 'config/diagnostics') return diagnostics as T;
    if (method === 'workspace/diff') return workspaceDiff as T;
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

const workspaceDiff: WorkspaceDiffResult = {
  repository: true,
  base: 'HEAD',
  files: [],
  truncated: false,
};

const finding: ReviewFindingPayload = {
  findingId: 'finding-1',
  title: 'Null crash',
  body: 'The branch dereferences null.',
  path: 'src/a.ts',
  startLine: 4,
  endLine: 4,
  priority: 1,
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
  it('reads workspace diff only through an adopted canonical thread', async () => {
    const transport = new FakeTransport();
    const agent = new DesktopProtocolAgent(transport, () => undefined);
    await expect(agent.diff()).rejects.toThrow('No active workspace thread');
    await agent.resume(thread.id);
    await expect(agent.diff()).resolves.toEqual(workspaceDiff);
    expect(transport.requests.at(-1)).toEqual({
      method: 'workspace/diff',
      params: { threadId: thread.id },
    });
  });

  it('applies a finding as a normal agent turn', async () => {
    const transport = new FakeTransport();
    const agent = new DesktopProtocolAgent(transport, () => undefined);
    await agent.resume(thread.id);
    await agent.applyFinding(finding);
    expect(transport.requests.at(-1)).toEqual({
      method: 'review/apply',
      params: { threadId: thread.id, findingIds: ['finding-1'] },
    });
  });

  it('reverts a review action through the canonical conflict-safe turn', async () => {
    const transport = new FakeTransport();
    const agent = new DesktopProtocolAgent(transport, () => undefined);
    await agent.resume(thread.id);
    await agent.revertAction('turn-apply');
    expect(transport.requests.at(-1)).toEqual({
      method: 'review/revert',
      params: { threadId: thread.id, actionId: 'turn-apply' },
    });
  });

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

  it('projects durable review findings for line-addressable UI rendering', async () => {
    const transport = new FakeTransport();
    const events: unknown[] = [];
    const agent = new DesktopProtocolAgent(transport, (event) => events.push(event));
    await agent.resume(thread.id);
    await agent.start({ userMessage: 'review' });
    transport.handler?.({
      type: 'item.completed',
      threadId: thread.id,
      turnId: turn.id,
      item: {
        id: 'item-1',
        type: 'review_finding',
        completedAt: '2026-08-01T00:00:02.000Z',
        payload: {
          findingId: 'finding-1',
          title: 'Null crash',
          body: 'This branch dereferences null.',
          path: 'src/a.ts',
          startLine: 4,
          endLine: 4,
          priority: 1,
        },
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'event',
        type: 'review_finding',
        payload: expect.objectContaining({ path: 'src/a.ts', startLine: 4 }),
      }),
    );
    transport.handler?.({
      type: 'item.completed',
      threadId: thread.id,
      turnId: turn.id,
      item: {
        id: 'item-2',
        type: 'review_action',
        completedAt: '2026-08-01T00:00:03.000Z',
        payload: { actionId: turn.id, kind: 'apply', findingIds: ['finding-1'] },
      },
    });
    // The envelope discriminator must survive: a review_action payload carries
    // its own `kind` ('apply' | 'revert'), which used to overwrite
    // `kind: 'event'` and hide the event from every consumer.
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'event',
        type: 'review_action',
        payload: expect.objectContaining({ kind: 'apply', findingIds: ['finding-1'] }),
      }),
    );
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

// The sidebar removed threads through Tauri while the protocol served
// `thread/archive` — a second writer against storage the app-server owns.
describe('thread removal', () => {
  it('archives through the protocol', async () => {
    const transport = new FakeTransport();
    const agent = new DesktopProtocolAgent(transport, () => undefined);
    expect(await agent.archiveThread('thread-1')).toBe(true);
    expect(transport.requests).toContainEqual({
      method: 'thread/archive',
      params: { threadId: 'thread-1' },
    });
  });

  it('deletes through the protocol', async () => {
    const transport = new FakeTransport();
    const agent = new DesktopProtocolAgent(transport, () => undefined);
    expect(await agent.deleteThread('thread-1')).toBe(true);
    expect(transport.requests).toContainEqual({
      method: 'thread/delete',
      params: { threadId: 'thread-1' },
    });
  });

  it('reports false — not an exception — when the server cannot manage threads', async () => {
    // The caller falls back to the local writer on false. Throwing would make a
    // sidecar that predates the method look like a delete that failed.
    const transport = new FakeTransport();
    const original = transport.connect.bind(transport);
    transport.connect = async () => {
      const init = await original();
      return { ...init, capabilities: { ...init.capabilities, threadManagement: false } };
    };
    const agent = new DesktopProtocolAgent(transport, () => undefined);
    expect(await agent.deleteThread('thread-1')).toBe(false);
    expect(transport.requests).toHaveLength(0);
  });
});
