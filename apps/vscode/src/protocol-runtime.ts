import type {
  InitializeResult,
  ProtocolEvent,
  ProtocolMethod,
  ThreadSnapshot,
  TurnSnapshot,
} from '@deepcode/protocol';

export interface EditorProtocolClient {
  connect(): Promise<InitializeResult>;
  request<T>(method: ProtocolMethod, params?: Record<string, unknown>): Promise<T>;
  subscribe(handler: (event: ProtocolEvent) => void): () => void;
  close(): Promise<void>;
}

export interface StartEditorTurn {
  text: string;
  threadId?: string;
  model?: string;
  effort?: string;
  mode?: string;
}

type EventHandler = (event: ProtocolEvent) => void;

/** Owns one editor's canonical thread and routes events by server turn id. */
export class EditorProtocolRuntime {
  private threadId?: string;
  private readonly turnThreads = new Map<string, string>();
  private readonly handlers = new Map<string, EventHandler>();
  private readonly queued = new Map<string, ProtocolEvent[]>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly client: EditorProtocolClient,
    private readonly cwd: () => string,
  ) {
    this.unsubscribe = client.subscribe((event) => this.route(event));
  }

  async start(
    input: StartEditorTurn,
    onEvent: EventHandler,
  ): Promise<{ threadId: string; turnId: string }> {
    if (!input.text.trim()) throw new Error('prompt is required');
    await this.client.connect();
    const thread = await this.ensureThread(input.threadId);
    const turn = await this.client.request<TurnSnapshot>('turn/start', {
      threadId: thread.id,
      input: {
        text: input.text,
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
      },
    });
    this.turnThreads.set(turn.id, thread.id);
    this.handlers.set(turn.id, onEvent);
    this.flush(turn.id);
    return { threadId: thread.id, turnId: turn.id };
  }

  async resume(threadId: string): Promise<ThreadSnapshot> {
    await this.client.connect();
    const thread = await this.client.request<ThreadSnapshot>('thread/resume', { threadId });
    this.threadId = thread.id;
    return thread;
  }

  async read(threadId: string): Promise<ThreadSnapshot> {
    await this.client.connect();
    return this.client.request('thread/read', { threadId });
  }

  async interrupt(turnId: string): Promise<boolean> {
    const threadId = this.turnThreads.get(turnId);
    if (!threadId) return false;
    const result = await this.client.request<{ interrupted: boolean }>('turn/interrupt', {
      threadId,
      turnId,
    });
    return result.interrupted;
  }

  approve(
    turnId: string,
    requestId: string,
    decision: 'allow' | 'deny' | 'always',
  ): Promise<{ accepted: boolean }> {
    return this.interactionRequest('approval/respond', turnId, { requestId, decision });
  }

  answer(turnId: string, requestId: string, answer: string): Promise<{ accepted: boolean }> {
    return this.interactionRequest('user-input/respond', turnId, { requestId, answer });
  }

  async close(): Promise<void> {
    this.unsubscribe();
    this.handlers.clear();
    this.turnThreads.clear();
    this.queued.clear();
    await this.client.close();
  }

  private async ensureThread(requested?: string): Promise<ThreadSnapshot> {
    if (requested && requested !== this.threadId) {
      const thread = await this.client.request<ThreadSnapshot>('thread/resume', {
        threadId: requested,
      });
      this.threadId = thread.id;
      return thread;
    }
    if (this.threadId) {
      return this.client.request<ThreadSnapshot>('thread/read', { threadId: this.threadId });
    }
    const thread = await this.client.request<ThreadSnapshot>('thread/start', { cwd: this.cwd() });
    this.threadId = thread.id;
    return thread;
  }

  private async interactionRequest(
    method: 'approval/respond' | 'user-input/respond',
    turnId: string,
    params: Record<string, unknown>,
  ): Promise<{ accepted: boolean }> {
    const threadId = this.turnThreads.get(turnId);
    if (!threadId) throw new Error(`Active turn not found: ${turnId}`);
    return this.client.request(method, { threadId, turnId, ...params });
  }

  private route(event: ProtocolEvent): void {
    const turnId = turnIdFrom(event);
    if (!turnId) return;
    const handler = this.handlers.get(turnId);
    if (!handler) {
      const queued = this.queued.get(turnId) ?? [];
      queued.push(event);
      this.queued.set(turnId, queued);
      return;
    }
    this.deliver(handler, event);
  }

  private flush(turnId: string): void {
    const handler = this.handlers.get(turnId);
    if (!handler) return;
    const events = this.queued.get(turnId) ?? [];
    this.queued.delete(turnId);
    for (const event of events) this.deliver(handler, event);
  }

  private deliver(handler: EventHandler, event: ProtocolEvent): void {
    handler(event);
    if (isTerminal(event)) {
      const turnId = event.turn.id;
      this.handlers.delete(turnId);
      this.turnThreads.delete(turnId);
      this.queued.delete(turnId);
    }
  }
}

function turnIdFrom(event: ProtocolEvent): string | undefined {
  if (event.type === 'thread.started') return undefined;
  if (
    event.type === 'turn.started' ||
    event.type === 'turn.completed' ||
    event.type === 'turn.interrupted' ||
    event.type === 'turn.failed'
  ) {
    return event.turn.id;
  }
  return event.turnId;
}

function isTerminal(
  event: ProtocolEvent,
): event is Extract<
  ProtocolEvent,
  { type: 'turn.completed' | 'turn.interrupted' | 'turn.failed' }
> {
  return (
    event.type === 'turn.completed' ||
    event.type === 'turn.interrupted' ||
    event.type === 'turn.failed'
  );
}
