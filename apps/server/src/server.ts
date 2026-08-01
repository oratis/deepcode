import {
  MemoryThreadStore,
  ProtocolInvariantError,
  ProtocolRuntime,
  type CompletedItemType,
  type ProtocolEvent,
  type ProtocolRequest,
  type ProtocolResponse,
  type ThreadSnapshot,
  type ThreadStore,
  type TurnSnapshot,
} from '@deepcode/protocol';

export interface TurnExecutionItem {
  type: CompletedItemType;
  payload: Record<string, unknown>;
}

export interface TurnExecutionResult {
  items?: TurnExecutionItem[];
  status?: 'completed' | 'failed';
}

export interface TurnExecutionArgs {
  thread: ThreadSnapshot;
  turn: TurnSnapshot;
  input: Record<string, unknown>;
  signal: AbortSignal;
  publishDelta: (itemId: string, delta: string) => void;
}

export interface TurnExecutor {
  execute(args: TurnExecutionArgs): Promise<TurnExecutionResult>;
}

export interface AppServerOptions {
  executor: TurnExecutor;
  store?: ThreadStore;
  now?: () => string;
  newId?: (prefix: 'thread' | 'turn' | 'item') => string;
  onEvent?: (event: ProtocolEvent) => void;
}

interface ActiveTurn {
  threadId: string;
  controller: AbortController;
  task: Promise<void>;
}

class RequestValidationError extends Error {}

export class AppServer {
  private readonly lifecycle: ProtocolRuntime;
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly terminalTransitions = new Map<string, Promise<TurnSnapshot>>();

  constructor(private readonly options: AppServerOptions) {
    this.lifecycle = new ProtocolRuntime({
      store: options.store ?? new MemoryThreadStore(),
      now: options.now,
      newId: options.newId,
      onEvent: options.onEvent,
    });
  }

  async handle(request: ProtocolRequest): Promise<ProtocolResponse> {
    try {
      return { id: request.id, result: await this.dispatch(request) };
    } catch (error) {
      const code =
        error instanceof ProtocolInvariantError
          ? 'invalid_state'
          : error instanceof RequestValidationError
            ? 'invalid_request'
            : 'internal_error';
      return {
        id: request.id,
        error: {
          code,
          message: (error as Error).message ?? String(error),
        },
      };
    }
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.activeTurns.values()].map(({ task }) => task));
  }

  async shutdown(): Promise<void> {
    const active = [...this.activeTurns.entries()];
    await Promise.all(
      active.map(async ([turnId, turn]) => {
        turn.controller.abort();
        await this.finishOnce(turnId, () => this.lifecycle.interruptTurn(turn.threadId, turnId));
      }),
    );
    await Promise.allSettled(active.map(([, { task }]) => task));
  }

  private async dispatch(request: ProtocolRequest): Promise<unknown> {
    switch (request.method) {
      case 'initialize':
        return this.lifecycle.initialize();
      case 'thread/start':
        return this.lifecycle.startThread(requiredString(request.params, 'cwd'));
      case 'thread/read':
        return this.lifecycle.readThread(requiredId(request.params, 'threadId'));
      case 'thread/resume':
        return this.resumeThread(requiredId(request.params, 'threadId'));
      case 'turn/start':
        return this.startTurn(request.params);
      case 'turn/interrupt':
        return this.interruptTurn(request.params);
    }
  }

  private async resumeThread(threadId: string): Promise<ThreadSnapshot> {
    let thread = await this.lifecycle.resumeThread(threadId);
    const orphaned = thread.turns.find(
      (turn) => turn.status === 'in_progress' && !this.activeTurns.has(turn.id),
    );
    if (orphaned) {
      await this.lifecycle.interruptTurn(threadId, orphaned.id);
      thread = await this.lifecycle.resumeThread(threadId);
    }
    return thread;
  }

  private async startTurn(params: Record<string, unknown>): Promise<TurnSnapshot> {
    const threadId = requiredId(params, 'threadId');
    const input = requiredRecord(params, 'input');
    const thread = await this.lifecycle.resumeThread(threadId);
    const turn = await this.lifecycle.startTurn(threadId, input);
    const controller = new AbortController();
    const task = this.executeTurn(thread, turn, input, controller);
    this.activeTurns.set(turn.id, { threadId, controller, task });
    return turn;
  }

  private async interruptTurn(params: Record<string, unknown>): Promise<{ interrupted: boolean }> {
    const threadId = requiredId(params, 'threadId');
    const turnId = requiredId(params, 'turnId');
    const active = this.activeTurns.get(turnId);
    if (!active) return { interrupted: false };
    if (active.threadId !== threadId)
      throw new RequestValidationError(`Turn ${turnId} does not belong to ${threadId}`);
    active.controller.abort();
    const terminal = await this.finishOnce(turnId, () =>
      this.lifecycle.interruptTurn(threadId, turnId),
    );
    return { interrupted: terminal.status === 'interrupted' };
  }

  private async executeTurn(
    thread: ThreadSnapshot,
    turn: TurnSnapshot,
    input: Record<string, unknown>,
    controller: AbortController,
  ): Promise<void> {
    try {
      const result = await this.options.executor.execute({
        thread,
        turn,
        input,
        signal: controller.signal,
        publishDelta: (itemId, delta) => {
          this.lifecycle.publishDelta({
            threadId: thread.id,
            turnId: turn.id,
            itemId,
            delta,
          });
        },
      });
      if (controller.signal.aborted) {
        await this.finishOnce(turn.id, () => this.lifecycle.interruptTurn(thread.id, turn.id));
        return;
      }
      for (const item of result.items ?? []) {
        await this.lifecycle.appendCompletedItem(thread.id, turn.id, item.type, item.payload);
      }
      if (result.status === 'failed') {
        await this.finishOnce(turn.id, () => this.lifecycle.failTurn(thread.id, turn.id));
      } else {
        await this.finishOnce(turn.id, () => this.lifecycle.completeTurn(thread.id, turn.id));
      }
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === 'AbortError') {
        await this.finishOnce(turn.id, () => this.lifecycle.interruptTurn(thread.id, turn.id));
      } else {
        await this.lifecycle.appendCompletedItem(thread.id, turn.id, 'error', {
          message: (error as Error).message ?? String(error),
        });
        await this.finishOnce(turn.id, () => this.lifecycle.failTurn(thread.id, turn.id));
      }
    } finally {
      this.activeTurns.delete(turn.id);
    }
  }

  private finishOnce(
    turnId: string,
    transition: () => Promise<TurnSnapshot>,
  ): Promise<TurnSnapshot> {
    const existing = this.terminalTransitions.get(turnId);
    if (existing) return existing;
    const pending = transition();
    this.terminalTransitions.set(turnId, pending);
    const cleanup = () => {
      if (this.terminalTransitions.get(turnId) === pending) {
        this.terminalTransitions.delete(turnId);
      }
    };
    void pending.then(cleanup, cleanup);
    return pending;
  }
}

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new RequestValidationError(`${key} is required`);
  }
  return value;
}

function requiredId(params: Record<string, unknown>, key: string): string {
  const value = requiredString(params, key);
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new RequestValidationError(`${key} is invalid`);
  }
  return value;
}

function requiredRecord(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = params[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestValidationError(`${key} must be an object`);
  }
  return value as Record<string, unknown>;
}
