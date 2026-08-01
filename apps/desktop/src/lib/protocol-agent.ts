import type {
  InitializeResult,
  ProtocolEvent,
  ProtocolMethod,
  ThreadSnapshot,
  TurnSnapshot,
} from '@deepcode/protocol';

import { setActiveSessionId } from './mac-session.js';
import { DesktopProtocolClient } from './protocol-client.js';

export interface ProtocolTransport {
  connect(): Promise<InitializeResult>;
  request<T>(method: ProtocolMethod, params?: Record<string, unknown>): Promise<T>;
  subscribe(handler: (event: ProtocolEvent) => void): () => void;
}

export interface StartProtocolTurnArgs {
  userMessage: string;
  cwd?: string;
  mode?: string;
  model?: string;
  effort?: string;
}

export interface DesktopAgentEvent {
  kind: 'event' | 'turn_done';
  turnId: string;
  [key: string]: unknown;
}

type PendingInteraction =
  | { kind: 'approval'; threadId: string; turnId: string }
  | { kind: 'user-input'; threadId: string; turnId: string };

export class DesktopProtocolAgent {
  private threadId: string | null = null;
  private readonly activeTurns = new Map<string, string>();
  private readonly pendingInteractions = new Map<string, PendingInteraction>();
  private readonly queuedTurns = new Map<string, ProtocolEvent[]>();

  constructor(
    private readonly transport: ProtocolTransport,
    private readonly emit: (event: DesktopAgentEvent) => void,
  ) {
    transport.subscribe((event) => this.receive(event));
  }

  async start(args: StartProtocolTurnArgs): Promise<{ turnId: string; threadId: string }> {
    await this.transport.connect();
    if (!this.threadId) {
      const thread = await this.transport.request<ThreadSnapshot>('thread/start', {
        cwd: args.cwd ?? '/',
      });
      this.adoptThread(thread.id);
    }
    const threadId = this.threadId;
    if (!threadId) throw new Error('app-server did not create a thread');
    const turn = await this.transport.request<TurnSnapshot>('turn/start', {
      threadId,
      input: {
        text: args.userMessage,
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.effort ? { effort: args.effort } : {}),
      },
    });
    this.activeTurns.set(turn.id, threadId);
    // The server can emit a complete fast turn before its start response reaches
    // the renderer. Flush on the next task so React records the returned turn id
    // before a terminal notification clears it.
    setTimeout(() => this.flushTurn(turn.id), 0);
    return { turnId: turn.id, threadId };
  }

  async resume(threadId: string): Promise<ThreadSnapshot> {
    await this.transport.connect();
    if (this.threadId && this.threadId !== threadId) {
      await this.interruptActiveTurns();
    }
    const thread = await this.transport.request<ThreadSnapshot>('thread/resume', { threadId });
    this.adoptThread(thread.id);
    return thread;
  }

  clear(): void {
    void this.interruptActiveTurns();
    this.threadId = null;
    setActiveSessionId(null);
  }

  async abort(turnId: string): Promise<boolean> {
    const threadId = this.activeTurns.get(turnId);
    if (!threadId) return false;
    const result = await this.transport.request<{ interrupted: boolean }>('turn/interrupt', {
      threadId,
      turnId,
    });
    return result.interrupted;
  }

  async approve(requestId: string, decision: 'allow' | 'deny' | 'always'): Promise<void> {
    const pending = this.requireInteraction(requestId, 'approval');
    await this.transport.request('approval/respond', {
      threadId: pending.threadId,
      turnId: pending.turnId,
      requestId,
      decision,
    });
    this.pendingInteractions.delete(requestId);
  }

  async answer(requestId: string, answer: string): Promise<void> {
    const pending = this.requireInteraction(requestId, 'user-input');
    await this.transport.request('user-input/respond', {
      threadId: pending.threadId,
      turnId: pending.turnId,
      requestId,
      answer,
    });
    this.pendingInteractions.delete(requestId);
  }

  private adoptThread(threadId: string): void {
    this.threadId = threadId;
    setActiveSessionId(threadId);
  }

  private receive(event: ProtocolEvent): void {
    const turnId = turnIdFrom(event);
    if (event.type === 'turn.started' && !this.activeTurns.has(turnId!)) {
      // A turn can finish before the response to turn/start reaches us. Buffer
      // only notifications for the currently adopted thread; late events from
      // an interrupted or previously selected thread must never reach the UI.
      if (event.threadId === this.threadId) this.queuedTurns.set(turnId!, [event]);
      return;
    }
    if (turnId && this.queuedTurns.has(turnId)) {
      this.queuedTurns.get(turnId)!.push(event);
      return;
    }
    if (turnId && !this.activeTurns.has(turnId)) return;
    this.project(event);
  }

  private flushTurn(turnId: string): void {
    const events = this.queuedTurns.get(turnId) ?? [];
    this.queuedTurns.delete(turnId);
    for (const event of events) this.project(event);
  }

  private project(event: ProtocolEvent): void {
    switch (event.type) {
      case 'item.delta':
        this.emit({ kind: 'event', turnId: event.turnId, type: 'text_delta', text: event.delta });
        break;
      case 'tool.started':
        this.emit({
          kind: 'event',
          turnId: event.turnId,
          type: 'tool_use',
          id: event.itemId,
          name: event.name,
          input: event.input,
        });
        break;
      case 'tool.completed':
        this.emit({
          kind: 'event',
          turnId: event.turnId,
          type: 'tool_result',
          id: event.itemId,
          result: event.result,
        });
        break;
      case 'usage.updated':
        this.emit({ kind: 'event', turnId: event.turnId, type: 'usage', ...event.usage });
        break;
      case 'approval.requested':
        this.pendingInteractions.set(event.requestId, {
          kind: 'approval',
          threadId: event.threadId,
          turnId: event.turnId,
        });
        this.emit({
          kind: 'event',
          turnId: event.turnId,
          type: 'permission_request',
          requestId: event.requestId,
          toolName: event.toolName,
          reason: event.reason,
        });
        break;
      case 'user-input.requested':
        this.pendingInteractions.set(event.requestId, {
          kind: 'user-input',
          threadId: event.threadId,
          turnId: event.turnId,
        });
        this.emit({
          kind: 'event',
          turnId: event.turnId,
          type: 'ask_user',
          requestId: event.requestId,
          question: event.question,
          options: event.options,
          multiSelect: event.multiSelect,
        });
        break;
      case 'turn.completed':
        this.finish(event.turn.id, 'end_turn');
        break;
      case 'turn.interrupted':
        this.finish(event.turn.id, 'aborted');
        break;
      case 'turn.failed': {
        const error = [...event.turn.items].reverse().find((item) => item.type === 'error')
          ?.payload.message;
        if (typeof error === 'string') {
          this.emit({ kind: 'event', turnId: event.turn.id, type: 'error', error });
        }
        this.finish(event.turn.id, 'error');
        break;
      }
    }
  }

  private finish(turnId: string, stopReason: 'end_turn' | 'aborted' | 'error'): void {
    if (!this.activeTurns.delete(turnId)) return;
    for (const [requestId, pending] of this.pendingInteractions) {
      if (pending.turnId === turnId) this.pendingInteractions.delete(requestId);
    }
    this.emit({ kind: 'turn_done', turnId, stopReason });
  }

  private requireInteraction<K extends PendingInteraction['kind']>(
    requestId: string,
    kind: K,
  ): Extract<PendingInteraction, { kind: K }> {
    const pending = this.pendingInteractions.get(requestId);
    if (!pending || pending.kind !== kind) {
      throw new Error(`Pending ${kind} request not found: ${requestId}`);
    }
    return pending as Extract<PendingInteraction, { kind: K }>;
  }

  private async interruptActiveTurns(): Promise<void> {
    const turns = [...this.activeTurns].map(([turnId, threadId]) => ({ turnId, threadId }));
    // Detach first so late deltas and terminal notifications from the previous
    // selection are ignored even if the interrupt response is delayed.
    this.activeTurns.clear();
    this.pendingInteractions.clear();
    this.queuedTurns.clear();
    await Promise.allSettled(
      turns.map(({ turnId, threadId }) =>
        this.transport.request('turn/interrupt', { threadId, turnId }),
      ),
    );
  }
}

function turnIdFrom(event: ProtocolEvent): string | undefined {
  if (event.type === 'thread.started') return undefined;
  if (event.type === 'turn.started') return event.turn.id;
  if (
    event.type === 'turn.completed' ||
    event.type === 'turn.interrupted' ||
    event.type === 'turn.failed'
  ) {
    return event.turn.id;
  }
  return event.turnId;
}

let emitToRenderer: (event: DesktopAgentEvent) => void = () => undefined;
const defaultAgent = new DesktopProtocolAgent(new DesktopProtocolClient(), (event) =>
  emitToRenderer(event),
);

export function installProtocolAgentEmitter(emit: (event: DesktopAgentEvent) => void): void {
  emitToRenderer = emit;
}

export function startProtocolTurn(args: StartProtocolTurnArgs) {
  return defaultAgent.start(args);
}

export function resumeProtocolThread(threadId: string) {
  return defaultAgent.resume(threadId);
}

export function clearProtocolThread(): void {
  defaultAgent.clear();
}

export function abortProtocolTurn(turnId: string) {
  return defaultAgent.abort(turnId);
}

export function approveProtocolRequest(requestId: string, decision: 'allow' | 'deny' | 'always') {
  return defaultAgent.approve(requestId, decision);
}

export function answerProtocolRequest(requestId: string, answer: string) {
  return defaultAgent.answer(requestId, answer);
}
