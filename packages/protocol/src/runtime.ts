import {
  PROTOCOL_VERSION,
  type CompletedItem,
  type CompletedItemType,
  type DurableProtocolEvent,
  type InitializeResult,
  type ProtocolEvent,
  type ThreadSnapshot,
  type TransientDeltaEvent,
  type TurnSnapshot,
  type TurnStatus,
} from './types.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface ThreadStore {
  load(threadId: string): Promise<ThreadSnapshot | null>;
  save(thread: ThreadSnapshot): Promise<void>;
}

export class MemoryThreadStore implements ThreadStore {
  private readonly threads = new Map<string, ThreadSnapshot>();
  saveCount = 0;

  async load(threadId: string): Promise<ThreadSnapshot | null> {
    const thread = this.threads.get(threadId);
    return thread ? clone(thread) : null;
  }

  async save(thread: ThreadSnapshot): Promise<void> {
    this.saveCount++;
    this.threads.set(thread.id, clone(thread));
  }
}

export interface ProtocolRuntimeOptions {
  store: ThreadStore;
  now?: () => string;
  newId?: (prefix: 'thread' | 'turn' | 'item') => string;
  newTraceId?: () => string;
  onEvent?: (event: ProtocolEvent) => void;
  configDiagnostics?: boolean;
  diagnosticExport?: boolean;
}

export class ProtocolInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolInvariantError';
  }
}

export class ProtocolRuntime {
  private readonly now: () => string;
  private readonly newId: (prefix: 'thread' | 'turn' | 'item') => string;
  private readonly newTraceId: () => string;

  constructor(private readonly options: ProtocolRuntimeOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId =
      options.newId ??
      ((prefix) =>
        `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    this.newTraceId =
      options.newTraceId ??
      (() => `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  }

  initialize(): InitializeResult {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        threadResume: true,
        turnInterrupt: true,
        completedItemPersistence: true,
        transientDeltas: true,
        structuredToolEvents: true,
        interactiveRequests: true,
        configDiagnostics: this.options.configDiagnostics ?? false,
        diagnosticExport: this.options.diagnosticExport ?? false,
      },
    };
  }

  async startThread(cwd: string, traceId?: string): Promise<ThreadSnapshot> {
    const now = this.now();
    const thread: ThreadSnapshot = {
      id: this.newId('thread'),
      cwd,
      createdAt: now,
      updatedAt: now,
      turns: [],
    };
    await this.options.store.save(thread);
    this.emit({ type: 'thread.started', traceId, thread: clone(thread) });
    return clone(thread);
  }

  readThread(threadId: string): Promise<ThreadSnapshot | null> {
    return this.options.store.load(threadId);
  }

  async resumeThread(threadId: string): Promise<ThreadSnapshot> {
    return this.requireThread(threadId);
  }

  async startTurn(
    threadId: string,
    input: Record<string, unknown>,
    traceId = this.newTraceId(),
  ): Promise<TurnSnapshot> {
    const thread = await this.requireThread(threadId);
    if (thread.turns.some((turn) => turn.status === 'in_progress')) {
      throw new ProtocolInvariantError(`Thread ${threadId} already has an active turn`);
    }
    const now = this.now();
    const inputItem = this.completedItem('user_message', input, now);
    const turn: TurnSnapshot = {
      id: this.newId('turn'),
      traceId,
      threadId,
      status: 'in_progress',
      startedAt: now,
      items: [inputItem],
    };
    thread.turns.push(turn);
    thread.updatedAt = now;
    await this.options.store.save(thread);
    this.emit({ type: 'turn.started', traceId, threadId, turn: clone(turn) });
    this.emit({
      type: 'item.completed',
      traceId,
      threadId,
      turnId: turn.id,
      item: clone(inputItem),
    });
    return clone(turn);
  }

  async appendCompletedItem(
    threadId: string,
    turnId: string,
    type: CompletedItemType,
    payload: Record<string, unknown>,
  ): Promise<CompletedItem> {
    const thread = await this.requireThread(threadId);
    const turn = this.requireTurn(thread, turnId);
    if (turn.status !== 'in_progress') {
      throw new ProtocolInvariantError(`Cannot append to terminal turn ${turnId}`);
    }
    const item = this.completedItem(type, payload, this.now());
    turn.items.push(item);
    thread.updatedAt = item.completedAt;
    await this.options.store.save(thread);
    this.emit({
      type: 'item.completed',
      traceId: turn.traceId,
      threadId,
      turnId,
      item: clone(item),
    });
    return clone(item);
  }

  publishDelta(event: Omit<TransientDeltaEvent, 'type'>): void {
    this.emit({ type: 'item.delta', ...event });
  }

  completeTurn(threadId: string, turnId: string): Promise<TurnSnapshot> {
    return this.finishTurn(threadId, turnId, 'completed');
  }

  interruptTurn(threadId: string, turnId: string): Promise<TurnSnapshot> {
    return this.finishTurn(threadId, turnId, 'interrupted');
  }

  failTurn(threadId: string, turnId: string): Promise<TurnSnapshot> {
    return this.finishTurn(threadId, turnId, 'failed');
  }

  private async finishTurn(
    threadId: string,
    turnId: string,
    requested: Exclude<TurnStatus, 'in_progress'>,
  ): Promise<TurnSnapshot> {
    const thread = await this.requireThread(threadId);
    const turn = this.requireTurn(thread, turnId);
    if (turn.status !== 'in_progress') return clone(turn);
    const now = this.now();
    turn.status = requested;
    turn.completedAt = now;
    thread.updatedAt = now;
    await this.options.store.save(thread);
    const type =
      requested === 'completed'
        ? 'turn.completed'
        : requested === 'interrupted'
          ? 'turn.interrupted'
          : 'turn.failed';
    this.emit({ type, traceId: turn.traceId, threadId, turn: clone(turn) } as DurableProtocolEvent);
    return clone(turn);
  }

  private async requireThread(threadId: string): Promise<ThreadSnapshot> {
    const thread = await this.options.store.load(threadId);
    if (!thread) throw new ProtocolInvariantError(`Thread not found: ${threadId}`);
    return thread;
  }

  private requireTurn(thread: ThreadSnapshot, turnId: string): TurnSnapshot {
    const turn = thread.turns.find((candidate) => candidate.id === turnId);
    if (!turn) throw new ProtocolInvariantError(`Turn not found: ${turnId}`);
    return turn;
  }

  private completedItem(
    type: CompletedItemType,
    payload: Record<string, unknown>,
    completedAt: string,
  ): CompletedItem {
    return { id: this.newId('item'), type, payload: clone(payload), completedAt };
  }

  private emit(event: ProtocolEvent): void {
    this.options.onEvent?.(event);
  }
}

export class ProtocolRecorder {
  private readonly records: DurableProtocolEvent[] = [];

  record(event: ProtocolEvent): void {
    if (isDurableEvent(event)) this.records.push(clone(event));
  }

  replay(consumer: (event: DurableProtocolEvent) => void): void {
    for (const event of this.records) consumer(clone(event));
  }

  snapshot(): DurableProtocolEvent[] {
    return clone(this.records);
  }
}

function isDurableEvent(event: ProtocolEvent): event is DurableProtocolEvent {
  return (
    event.type === 'thread.started' ||
    event.type === 'turn.started' ||
    event.type === 'item.completed' ||
    event.type === 'turn.completed' ||
    event.type === 'turn.interrupted' ||
    event.type === 'turn.failed'
  );
}
