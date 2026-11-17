import type {
  InitializeResult,
  ProtocolClientConnection,
  ProtocolEvent,
  ProtocolRequest,
  ThreadSnapshot,
  TurnSnapshot,
} from '@deepcode/protocol';
import { describe, expect, it } from 'vitest';
import { EditorAppServerClient } from './editor-client.js';
import { EditorProtocolRuntime } from './protocol-runtime.js';
import { ChatPanelController, type ChatPanelMessage } from './chat-panel.js';

const initialized: InitializeResult = {
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
    workspaceDiff: true,
    reviewActions: true,
    reasoningDeltas: true,
    threadManagement: true,
    runtimeCapabilities: true,
  },
};
const thread: ThreadSnapshot = {
  id: 'thread-1',
  cwd: '/workspace',
  createdAt: '2026-11-17T00:00:00Z',
  updatedAt: '2026-11-17T00:00:00Z',
  turns: [],
};

class FakeConnection implements ProtocolClientConnection {
  sessions: Array<{
    message: (value: string) => void;
    disconnect: (error: Error) => void;
    active: boolean;
  }> = [];
  requests: ProtocolRequest[] = [];
  holdTurnStart = false;
  holdInterrupt = false;
  rejectInterrupt = false;
  disconnectOnOpen = false;
  disconnectAfterStartReply = false;
  closeBarrier?: Promise<void>;
  closeCalls = 0;
  turn?: TurnSnapshot;

  async open(message: (value: string) => void, disconnect: (error: Error) => void): Promise<void> {
    this.sessions.push({ message, disconnect, active: true });
    if (this.disconnectOnOpen) {
      this.disconnectOnOpen = false;
      this.fail();
    }
  }

  async send(line: string): Promise<void> {
    const session = this.sessions.at(-1)!;
    if (!session.active) throw new Error('connection closed');
    const request = JSON.parse(line) as ProtocolRequest;
    this.requests.push(request);
    const reply = (result: unknown) => session.message(JSON.stringify({ id: request.id, result }));
    if (request.method === 'initialize') reply(initialized);
    else if (
      request.method === 'thread/start' ||
      request.method === 'thread/read' ||
      request.method === 'thread/resume'
    )
      reply(thread);
    else if (request.method === 'turn/start') {
      this.turn = {
        id: `turn-${this.requests.filter((item) => item.method === 'turn/start').length}`,
        threadId: thread.id,
        status: 'in_progress',
        startedAt: thread.createdAt,
        items: [],
      };
      this.emit({ type: 'turn.started', threadId: thread.id, turn: this.turn });
      if (!this.holdTurnStart) reply(this.turn);
      if (this.disconnectAfterStartReply) {
        this.disconnectAfterStartReply = false;
        this.fail();
      }
    } else if (request.method === 'turn/interrupt') {
      if (this.rejectInterrupt) throw new Error('Stop request failed, connection still open');
      if (!this.holdInterrupt) reply({ interrupted: true });
    } else reply({ accepted: true });
  }

  emit(event: ProtocolEvent, index = this.sessions.length - 1): void {
    this.sessions[index]!.message(JSON.stringify({ method: 'event', params: event }));
  }

  fail(): void {
    const session = this.sessions.at(-1)!;
    session.active = false;
    session.disconnect(new Error('Backend terminated'));
  }

  async close(): Promise<void> {
    this.closeCalls++;
    await this.closeBarrier;
    const session = this.sessions.at(-1);
    if (session) session.active = false;
  }
}

function setup() {
  const connection = new FakeConnection();
  const client = new EditorAppServerClient(connection);
  const runtime = new EditorProtocolRuntime(client, () => '/workspace');
  const messages: ChatPanelMessage[] = [];
  const panel = new ChatPanelController(
    runtime,
    (message) => messages.push(message),
    (text) => ({ text }),
    async () => undefined,
  );
  const status = () => messages.filter((message) => message.kind === 'status').at(-1);
  return { connection, client, runtime, messages, panel, status };
}

describe('editor transport lifecycle', () => {
  it('unblocks the panel on a confirmed disconnect, keeps unknown effects, and resumes only on a new Send', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Write a file' });
    s.connection.emit({
      type: 'tool.started',
      threadId: thread.id,
      turnId: 'turn-1',
      itemId: 'tool-1',
      name: 'Write',
      input: { path: 'a.ts' },
    });
    s.connection.fail();
    expect(s.status()).toMatchObject({ status: 'disconnected' });
    expect(s.messages).toContainEqual(
      expect.objectContaining({
        kind: 'tool',
        id: JSON.stringify(['turn-1', 'tool-1']),
        status: 'unsettled',
        output: expect.stringContaining('effects are unknown'),
      }),
    );
    expect(s.connection.requests.filter((item) => item.method === 'turn/start')).toHaveLength(1);
    await expect(s.runtime.interrupt('turn-1')).resolves.toBe(false);
    await expect(s.runtime.approve('turn-1', 'old-approval', 'allow')).rejects.toThrow(
      'Active turn not found',
    );
    await s.panel.receive({ kind: 'send', text: 'Inspect the workspace before continuing' });
    expect(s.connection.sessions).toHaveLength(2);
    expect(s.connection.requests.slice(-3).map((request) => request.method)).toEqual([
      'initialize',
      'thread/resume',
      'turn/start',
    ]);
    expect(s.status()).toMatchObject({ status: 'working' });
    const count = s.messages.length;
    s.connection.emit(
      {
        type: 'turn.completed',
        threadId: thread.id,
        turn: { ...s.connection.turn!, id: 'turn-1', status: 'completed' },
      },
      0,
    );
    s.connection.sessions[0]!.disconnect(new Error('Duplicate old disconnect'));
    expect(s.messages).toHaveLength(count);
    await s.runtime.close();
  });

  it('does not mistake an ordinary Stop failure for a disconnect or start another writer', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Work' });
    s.connection.rejectInterrupt = true;
    await s.panel.receive({ kind: 'stop' });
    expect(s.status()).toMatchObject({
      status: 'working',
      detail: expect.stringContaining('may still be running'),
    });
    await s.panel.receive({ kind: 'send', text: 'Must not overlap' });
    expect(s.connection.requests.filter((item) => item.method === 'turn/start')).toHaveLength(1);
    expect(s.connection.sessions).toHaveLength(1);
    await s.runtime.close();
  });

  it('settles disconnect during a pending Stop without a later rejection reviving Working', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Work' });
    s.connection.holdInterrupt = true;
    const stopping = s.panel.receive({ kind: 'stop' });
    expect(s.status()).toMatchObject({ status: 'cancelling' });
    s.connection.fail();
    await stopping;
    expect(s.status()).toMatchObject({ status: 'disconnected' });
    await s.runtime.close();
  });

  it('clears buffered turn events when disconnected before turn/start responds', async () => {
    const s = setup();
    s.connection.holdTurnStart = true;
    const pending = s.panel.receive({ kind: 'send', text: 'Work' });
    await expect.poll(() => s.connection.turn?.id).toBe('turn-1');
    s.connection.fail();
    await pending;
    expect(s.status()).toMatchObject({ status: 'disconnected' });
    s.connection.holdTurnStart = false;
    await s.panel.receive({ kind: 'send', text: 'Continue after inspecting' });
    expect(s.status()).toMatchObject({ status: 'working' });
    await expect(s.runtime.interrupt('turn-1')).resolves.toBe(false);
    await s.runtime.close();
  });

  it('can reconnect after the child disconnects during connection startup', async () => {
    const s = setup();
    s.connection.disconnectOnOpen = true;
    await s.panel.receive({ kind: 'send', text: 'First attempt' });
    expect(s.status()).toMatchObject({ status: 'disconnected' });
    await s.panel.receive({ kind: 'send', text: 'A new explicit request' });
    expect(s.connection.sessions).toHaveLength(2);
    expect(s.status()).toMatchObject({ status: 'working' });
    await s.runtime.close();
  });

  it('does not track a start response that was already resolved when the connection died', async () => {
    const s = setup();
    s.connection.disconnectAfterStartReply = true;
    await s.panel.receive({ kind: 'send', text: 'Work' });
    expect(s.status()).toMatchObject({ status: 'disconnected' });
    await expect(s.runtime.interrupt('turn-1')).resolves.toBe(false);
    await s.panel.receive({ kind: 'send', text: 'Inspect and continue' });
    expect(s.status()).toMatchObject({ status: 'working' });
    expect(s.connection.sessions).toHaveLength(2);
    await s.runtime.close();
  });

  it.each(['unexpected stdout line', 'null', '[]'])(
    'closes an invalid protocol stream before allowing reconnection: %s',
    async (frame) => {
      const s = setup();
      await s.panel.receive({ kind: 'send', text: 'Work' });
      let releaseClose!: () => void;
      s.connection.closeBarrier = new Promise<void>((resolve) => {
        releaseClose = resolve;
      });
      s.connection.sessions[0]!.message(frame);
      expect(s.connection.closeCalls).toBe(1);
      expect(s.status()).toMatchObject({ status: 'working' });
      await s.panel.receive({ kind: 'send', text: 'Must wait for close' });
      expect(
        s.connection.requests.filter((request) => request.method === 'turn/start'),
      ).toHaveLength(1);
      const count = s.messages.length;
      s.connection.emit({
        type: 'item.delta',
        threadId: thread.id,
        turnId: 'turn-1',
        itemId: 'assistant',
        delta: 'Late untrusted frame',
      });
      expect(s.messages).toHaveLength(count);
      const reconnect = s.client.connect();
      await Promise.resolve();
      expect(s.connection.sessions).toHaveLength(1);
      releaseClose();
      await reconnect;
      expect(s.status()).toMatchObject({ status: 'disconnected' });
      expect(s.connection.sessions).toHaveLength(2);
      await s.panel.receive({ kind: 'send', text: 'Inspect before continuing' });
      expect(s.status()).toMatchObject({ status: 'working' });
      expect(s.connection.requests.slice(-2).map((request) => request.method)).toEqual([
        'thread/resume',
        'turn/start',
      ]);
      await s.runtime.close();
    },
  );

  it('never opens a replacement owner if invalid-frame transport cleanup fails', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Work' });
    s.connection.closeBarrier = Promise.reject(new Error('Could not close the owned child'));
    s.connection.sessions[0]!.message('invalid JSON');
    await expect
      .poll(() => s.status()?.kind === 'status' && s.status()?.status)
      .toBe('disconnected');
    await s.panel.receive({ kind: 'send', text: 'Attempt recovery' });
    expect(s.connection.sessions).toHaveLength(1);
    expect(s.messages).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        role: 'error',
        text: expect.stringContaining('Could not close the owned child'),
      }),
    );
    s.connection.closeBarrier = undefined;
    await s.runtime.close();
  });

  it('keeps a malformed-stream startup pending until cleanup, so a retry cannot become an invisible turn', async () => {
    const s = setup();
    s.connection.holdTurnStart = true;
    let releaseClose!: () => void;
    s.connection.closeBarrier = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const starting = s.panel.receive({ kind: 'send', text: 'Original request' });
    await expect.poll(() => s.connection.turn?.id).toBe('turn-1');
    s.connection.sessions[0]!.message('invalid protocol line');
    await Promise.resolve();
    await Promise.resolve();
    expect(s.status()).toMatchObject({ status: 'starting' });
    await s.panel.receive({ kind: 'send', text: 'Too early' });
    expect(s.connection.requests.filter((request) => request.method === 'turn/start')).toHaveLength(
      1,
    );
    releaseClose();
    await starting;
    expect(s.status()).toMatchObject({ status: 'disconnected' });
    s.connection.holdTurnStart = false;
    await s.panel.receive({ kind: 'send', text: 'Explicit request after cleanup' });
    expect(s.status()).toMatchObject({ status: 'working' });
    expect(s.connection.requests.filter((request) => request.method === 'turn/start')).toHaveLength(
      2,
    );
    await s.runtime.close();
  });
});
