import type { ProtocolEvent, TurnSnapshot } from '@deepcode/protocol';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanelController, type ChatPanelMessage } from './chat-panel.js';
import { chatHtml } from './chat-html.js';

const turn: TurnSnapshot = {
  id: 'turn-1',
  threadId: 'thread-1',
  status: 'in_progress',
  startedAt: '2026-11-17T00:00:00Z',
  items: [],
};

function setup() {
  let currentTurn = turn;
  let onEvent: (event: ProtocolEvent) => void = () => undefined;
  let onDisconnect: (error: Error) => void = () => undefined;
  const runtime = {
    start: vi.fn(async (_input: unknown, handler: (event: ProtocolEvent) => void) => {
      onEvent = handler;
      handler({ type: 'turn.started', threadId: 'thread-1', turn: currentTurn });
      return { threadId: 'thread-1', turnId: currentTurn.id };
    }),
    interrupt: vi.fn(async () => true),
    subscribeDisconnect: vi.fn((handler: (error: Error) => void) => {
      onDisconnect = handler;
      return () => {
        onDisconnect = () => undefined;
      };
    }),
  };
  const messages: ChatPanelMessage[] = [];
  const interact = vi.fn(async (): Promise<void> => undefined);
  const panel = new ChatPanelController(
    runtime,
    (message) => messages.push(message),
    (text) => ({ text }),
    interact,
  );
  const emit = (event: ProtocolEvent) => onEvent(event);
  const finish = (type: 'turn.completed' | 'turn.interrupted' | 'turn.failed') =>
    emit({
      type,
      threadId: 'thread-1',
      turn: {
        ...currentTurn,
        status:
          type === 'turn.completed'
            ? 'completed'
            : type === 'turn.interrupted'
              ? 'interrupted'
              : 'failed',
      },
    });
  const status = () => messages.filter((message) => message.kind === 'status').at(-1);
  return {
    panel,
    runtime,
    messages,
    interact,
    emit,
    finish,
    status,
    disconnect: (error: Error) => onDisconnect(error),
    nextTurn: (id: string) => {
      currentTurn = { ...turn, id };
    },
  };
}

describe('ChatPanelController', () => {
  it('validates untrusted messages and blocks duplicate sends until a terminal event', async () => {
    const s = setup();
    for (const value of [
      null,
      2,
      {},
      { kind: 'send', text: {} },
      { kind: 'send', text: '  ' },
      { kind: 'approve', decision: 'always' },
    ])
      await s.panel.receive(value);
    expect(s.runtime.start).not.toHaveBeenCalled();
    await s.panel.receive({ kind: 'send', text: 'Inspect this' });
    await s.panel.receive({ kind: 'send', text: 'Must not run' });
    expect(s.runtime.start).toHaveBeenCalledTimes(1);
    s.finish('turn.completed');
    await s.panel.receive({ kind: 'send', text: 'Next turn' });
    expect(s.runtime.start).toHaveBeenCalledTimes(2);
  });

  it('keeps cancelling after interrupt acknowledgement and rejects sends until settlement', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Work' });
    await s.panel.receive({ kind: 'stop' });
    await s.panel.receive({ kind: 'stop' });
    await s.panel.receive({ kind: 'send', text: 'Too early' });
    expect(s.runtime.interrupt).toHaveBeenCalledExactlyOnceWith('turn-1');
    expect(s.status()).toMatchObject({ status: 'cancelling' });
    expect(s.runtime.start).toHaveBeenCalledTimes(1);
    s.finish('turn.interrupted');
    expect(s.status()).toMatchObject({ status: 'interrupted' });
    await s.panel.receive({ kind: 'send', text: 'Now safe' });
    expect(s.runtime.start).toHaveBeenCalledTimes(2);
  });

  it('remembers Stop during startup and does not resurrect a fast terminal turn', async () => {
    const s = setup();
    let resolveStart!: (value: { threadId: string; turnId: string }) => void;
    let event!: (value: ProtocolEvent) => void;
    s.runtime.start.mockImplementation((_input, handler) => {
      event = handler;
      return new Promise((resolve) => {
        resolveStart = resolve;
      });
    });
    const pending = s.panel.receive({ kind: 'send', text: 'Work' });
    await s.panel.receive({ kind: 'stop' });
    expect(s.runtime.interrupt).not.toHaveBeenCalled();
    resolveStart({ threadId: 'thread-1', turnId: 'turn-1' });
    await pending;
    expect(s.runtime.interrupt).toHaveBeenCalledExactlyOnceWith('turn-1');
    event({
      type: 'turn.interrupted',
      threadId: 'thread-1',
      turn: { ...turn, status: 'interrupted' },
    });
    expect(s.status()).toMatchObject({ status: 'interrupted' });

    s.runtime.start.mockImplementation(async (_input, handler) => {
      handler({
        type: 'turn.completed',
        threadId: 'thread-1',
        turn: { ...turn, status: 'completed' },
      });
      return { threadId: 'thread-1', turnId: 'turn-1' };
    });
    await s.panel.receive({ kind: 'send', text: 'Very fast' });
    await s.panel.receive({ kind: 'stop' });
    expect(s.runtime.interrupt).toHaveBeenCalledTimes(1);
    expect(s.status()).toMatchObject({ status: 'completed' });
  });

  it('shows failed interruption as still running and allows a stop retry', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Work' });
    s.runtime.interrupt.mockRejectedValueOnce(new Error('Transport unavailable'));
    await s.panel.receive({ kind: 'stop' });
    expect(s.status()).toMatchObject({
      status: 'working',
      detail: expect.stringContaining('may still be running'),
    });
    await s.panel.receive({ kind: 'send', text: 'Unsafe overlap' });
    expect(s.runtime.start).toHaveBeenCalledTimes(1);
    await s.panel.receive({ kind: 'stop' });
    expect(s.runtime.interrupt).toHaveBeenCalledTimes(2);
  });

  it('keeps tool output paired and splits assistant text around tool activity', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Work' });
    const delta = {
      type: 'item.delta' as const,
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant',
      delta: 'Before',
    };
    s.emit(delta);
    s.emit({
      type: 'tool.started',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      name: 'Read',
      input: { file_path: '<script>bad()</script>' },
    });
    s.emit({
      type: 'tool.completed',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      result: { content: 'x'.repeat(25_000), isError: true },
    });
    s.emit({ ...delta, delta: 'After' });
    const deltas = s.messages.filter((message) => message.kind === 'delta');
    expect(deltas).toHaveLength(2);
    expect(deltas[0]!.id).not.toEqual(deltas[1]!.id);
    expect(s.messages.filter((message) => message.kind === 'tool')).toEqual([
      expect.objectContaining({
        id: JSON.stringify(['turn-1', 'tool-1']),
        name: 'Read',
        summary: '<script>bad()</script>',
        status: 'running',
      }),
      expect.objectContaining({
        id: JSON.stringify(['turn-1', 'tool-1']),
        status: 'failed',
        output: expect.stringContaining('Output shortened in this view'),
      }),
    ]);
  });

  it('keeps unresolved tool effects unknown and drops late events after terminal state', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Work' });
    s.emit({
      type: 'tool.started',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      name: 'Bash',
      input: { command: 'build' },
    });
    s.finish('turn.interrupted');
    expect(s.messages).toContainEqual(
      expect.objectContaining({
        kind: 'tool',
        id: JSON.stringify(['turn-1', 'tool-1']),
        status: 'unsettled',
      }),
    );
    const count = s.messages.length;
    s.emit({
      type: 'tool.completed',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      result: { content: 'late' },
    });
    expect(s.messages).toHaveLength(count);
  });

  it('keeps repeated provider tool ids separate across turns, settlement, and transcript replay', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'First turn' });
    s.emit({
      type: 'tool.started',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      name: 'Read',
      input: { path: 'first.ts' },
    });
    s.emit({
      type: 'tool.completed',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'tool-1',
      result: { content: 'First result' },
    });
    s.finish('turn.completed');
    s.nextTurn('turn-2');
    await s.panel.receive({ kind: 'send', text: 'Second turn' });
    s.emit({
      type: 'tool.started',
      threadId: 'thread-1',
      turnId: 'turn-2',
      itemId: 'tool-1',
      name: 'Write',
      input: { path: 'second.ts' },
    });
    s.finish('turn.interrupted');
    s.messages.length = 0;
    await s.panel.receive({ kind: 'ready' });
    const cards = new Map<string, Extract<ChatPanelMessage, { kind: 'tool' }>>();
    for (const message of s.messages) {
      if (message.kind === 'tool') cards.set(message.id, { ...cards.get(message.id), ...message });
    }
    expect(cards.size).toBe(2);
    expect(cards.get(JSON.stringify(['turn-1', 'tool-1']))).toMatchObject({
      name: 'Read',
      status: 'completed',
      output: 'First result',
    });
    expect(cards.get(JSON.stringify(['turn-2', 'tool-1']))).toMatchObject({
      name: 'Write',
      status: 'unsettled',
      output: expect.stringContaining('No tool result'),
    });
  });

  it('drops disconnected runs and late approvals without calling them completed or interrupted', async () => {
    const s = setup();
    let resolveApproval!: () => void;
    s.interact.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveApproval = resolve;
        }),
    );
    await s.panel.receive({ kind: 'send', text: 'Work' });
    s.emit({
      type: 'approval.requested',
      threadId: 'thread-1',
      turnId: 'turn-1',
      requestId: 'approval-1',
      toolName: 'Write',
      reason: 'Write?',
    });
    s.disconnect(new Error('Backend terminated'));
    resolveApproval();
    await Promise.resolve();
    s.finish('turn.completed');
    expect(s.status()).toMatchObject({
      status: 'disconnected',
      detail: expect.stringContaining('outcome is unknown'),
    });
    expect(s.runtime.start).toHaveBeenCalledTimes(1);
    await s.panel.receive({ kind: 'send', text: 'Inspect before continuing' });
    expect(s.runtime.start).toHaveBeenCalledTimes(2);
    s.panel.dispose();
    s.disconnect(new Error('Ignored after disposal'));
    expect(s.status()).toMatchObject({ status: 'working' });
  });

  it('keeps the beginning and failure tail of large tool output within a bounded preview', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Work' });
    const head = 'Build started\n' + 'h'.repeat(15_986);
    const tail = 't'.repeat(7_970) + '\nFAILED: missing configuration';
    const content = head + 'omitted middle'.repeat(10_000) + tail;
    s.emit({
      type: 'tool.completed',
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'large-tool',
      result: { content, isError: true },
    });
    const output = s.messages.find(
      (message) =>
        message.kind === 'tool' && message.id === JSON.stringify(['turn-1', 'large-tool']),
    );
    expect(output?.kind).toBe('tool');
    if (output?.kind !== 'tool') return;
    expect(output.output?.startsWith(content.slice(0, 16_000))).toBe(true);
    expect(output.output?.endsWith(content.slice(-8_000))).toBe(true);
    expect(output.output).toContain(
      `${content.length - 24_000} characters omitted from the middle`,
    );
    expect(output.output).not.toContain('omitted middle');
    expect(output.output!.length).toBeLessThan(24_150);
  });

  it('does not revive a cancelled turn after a late native approval response', async () => {
    const s = setup();
    let resolveApproval!: () => void;
    s.interact.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve;
        }),
    );
    await s.panel.receive({ kind: 'send', text: 'Work' });
    s.emit({
      type: 'approval.requested',
      threadId: 'thread-1',
      turnId: 'turn-1',
      requestId: 'approval-1',
      toolName: 'Write',
      reason: 'Write file?',
    });
    expect(s.status()).toMatchObject({ status: 'approval' });
    await s.panel.receive({ kind: 'stop' });
    s.finish('turn.interrupted');
    resolveApproval();
    await Promise.resolve();
    expect(s.status()).toMatchObject({ status: 'interrupted' });
  });

  it('restores the projected transcript and running state when the webview is recreated', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Work' });
    const delta = {
      type: 'item.delta' as const,
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'assistant',
      delta: 'One ',
    };
    s.emit(delta);
    s.emit({ ...delta, delta: 'two' });
    s.messages.length = 0;
    await s.panel.receive({ kind: 'ready' });
    expect(s.messages[0]).toEqual({ kind: 'reset' });
    expect(s.messages.filter((message) => message.kind === 'delta')).toEqual([
      expect.objectContaining({ text: 'One two' }),
    ]);
    expect(s.status()).toMatchObject({ status: 'working' });
  });

  it('keeps waiting while another native approval is still pending', async () => {
    const s = setup();
    const resolutions: Array<() => void> = [];
    s.interact.mockImplementation(() => new Promise<void>((resolve) => resolutions.push(resolve)));
    await s.panel.receive({ kind: 'send', text: 'Work' });
    const approval = {
      type: 'approval.requested' as const,
      threadId: 'thread-1',
      turnId: 'turn-1',
      requestId: 'approval-1',
      toolName: 'Write',
      reason: 'Write file?',
    };
    s.emit(approval);
    s.emit({ ...approval, requestId: 'approval-2' });
    resolutions[0]!();
    await Promise.resolve();
    expect(s.status()).toMatchObject({ status: 'approval' });
    resolutions[1]!();
    await Promise.resolve();
    expect(s.status()).toMatchObject({ status: 'working' });
  });

  it('renders completed text when a provider does not stream', async () => {
    const s = setup();
    await s.panel.receive({ kind: 'send', text: 'Work' });
    s.emit({
      type: 'item.completed',
      threadId: 'thread-1',
      turnId: 'turn-1',
      item: {
        id: 'assistant-1',
        type: 'assistant_message',
        completedAt: turn.startedAt,
        payload: { message: { content: [{ type: 'text', text: 'The complete answer.' }] } },
      },
    });
    expect(s.messages).toContainEqual({
      kind: 'message',
      id: 'assistant-1',
      role: 'assistant',
      text: 'The complete answer.',
    });
  });

  it('shows startup and terminal errors without treating them as successful answers', async () => {
    const s = setup();
    s.runtime.start.mockRejectedValueOnce(new Error('Missing provider credential'));
    await s.panel.receive({ kind: 'send', text: 'Work' });
    expect(s.status()).toMatchObject({ status: 'failed' });
    expect(s.messages).toContainEqual(
      expect.objectContaining({ role: 'error', text: 'Missing provider credential' }),
    );
    await s.panel.receive({ kind: 'send', text: 'Retry' });
    s.emit({
      type: 'turn.failed',
      threadId: 'thread-1',
      turn: {
        ...turn,
        status: 'failed',
        items: [
          {
            id: 'error',
            type: 'error',
            completedAt: turn.startedAt,
            payload: { message: 'cleanup_incomplete' },
          },
        ],
      },
    });
    expect(s.status()).toMatchObject({ status: 'failed' });
    expect(s.messages).toContainEqual(
      expect.objectContaining({ role: 'error', text: 'cleanup_incomplete' }),
    );
  });
});

describe('chat webview security and accessible controls', () => {
  it('locks scripts/styles to a fresh nonce and renders dynamic text without HTML insertion', () => {
    const html = chatHtml();
    const nonce = /<script nonce="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`script-src 'nonce-${nonce}'`);
    expect(html).toContain(`style-src 'nonce-${nonce}'`);
    expect(html).toContain("default-src 'none'");
    expect(chatHtml()).not.toContain(nonce);
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|unsafe-inline/);
    expect(html).toContain('aria-label="Message DeepCode"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('!event.isComposing');
  });
});
