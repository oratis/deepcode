import {
  isReviewFindingPayload,
  MemoryThreadStore,
  ProtocolInvariantError,
  ProtocolRuntime,
  reviewApplyManyPrompt,
  reviewRevertPrompt,
  type CompletedItemType,
  type ConfigDiagnosticsResult,
  type DiagnosticExportResult,
  type ProtocolEvent,
  type ProtocolRequest,
  type ProtocolResponse,
  type ReviewActionPayload,
  type ReviewActionRequest,
  type ReviewFindingPayload,
  type ThreadSnapshot,
  type ThreadStore,
  type TurnSnapshot,
  type WorkspaceDiffResult,
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
  publishReasoning: (itemId: string, delta: string) => void;
  publishToolStarted: (itemId: string, name: string, input: Record<string, unknown>) => void;
  publishToolCompleted: (itemId: string, result: { content: string; isError?: boolean }) => void;
  publishUsage: (usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
  }) => void;
  requestApproval: (toolName: string, reason: string) => Promise<'allow' | 'deny' | 'always'>;
  requestUserInput: (request: {
    question: string;
    options: Array<{ label: string; description: string }>;
    multiSelect?: boolean;
  }) => Promise<string>;
}

export interface TurnExecutor {
  execute(args: TurnExecutionArgs): Promise<TurnExecutionResult>;
}

export interface AppServerOptions {
  executor: TurnExecutor;
  store?: ThreadStore;
  now?: () => string;
  newId?: (prefix: 'thread' | 'turn' | 'item') => string;
  newTraceId?: () => string;
  onEvent?: (event: ProtocolEvent) => void;
  onTrace?: (record: AppServerTraceRecord) => void;
  configDiagnostics?: (cwd: string) => Promise<ConfigDiagnosticsResult>;
  diagnosticExport?: (cwd: string) => Promise<DiagnosticExportResult>;
  workspaceDiff?: (cwd: string) => Promise<WorkspaceDiffResult>;
}

/** Strictly metadata-only records; no prompt, tool payload, command, or error message. */
export interface AppServerTraceRecord {
  event: string;
  traceId: string;
  protocolRequestId?: string | number;
  method?: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  status?: string;
  code?: string;
  durationMs?: number;
}

interface ActiveTurn {
  threadId: string;
  controller: AbortController;
  task: Promise<void>;
}

type PendingInteraction =
  | {
      kind: 'approval';
      threadId: string;
      turnId: string;
      resolve: (decision: 'allow' | 'deny' | 'always') => void;
    }
  | {
      kind: 'user-input';
      threadId: string;
      turnId: string;
      resolve: (answer: string) => void;
    };

class RequestValidationError extends Error {}

export class AppServer {
  private readonly lifecycle: ProtocolRuntime;
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly terminalTransitions = new Map<string, Promise<TurnSnapshot>>();
  private readonly pendingInteractions = new Map<string, PendingInteraction>();
  private interactionSequence = 0;
  private readonly newTraceId: () => string;

  constructor(private readonly options: AppServerOptions) {
    this.newTraceId =
      options.newTraceId ??
      (() => `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    this.lifecycle = new ProtocolRuntime({
      store: options.store ?? new MemoryThreadStore(),
      now: options.now,
      newId: options.newId,
      newTraceId: this.newTraceId,
      onEvent: options.onEvent,
      configDiagnostics: options.configDiagnostics !== undefined,
      diagnosticExport: options.diagnosticExport !== undefined,
      workspaceDiff: options.workspaceDiff !== undefined,
      reviewActions: true,
      reasoningDeltas: true,
    });
  }

  async handle(request: ProtocolRequest): Promise<ProtocolResponse> {
    const traceId = this.newTraceId();
    const startedAt = Date.now();
    this.trace({
      event: 'protocol.request.started',
      traceId,
      protocolRequestId: request.id,
      method: request.method,
    });
    try {
      const result = await this.dispatch(request, traceId);
      this.trace({
        event: 'protocol.request.completed',
        traceId,
        protocolRequestId: request.id,
        method: request.method,
        status: 'ok',
        durationMs: Date.now() - startedAt,
      });
      return { id: request.id, result };
    } catch (error) {
      const code =
        error instanceof ProtocolInvariantError
          ? 'invalid_state'
          : error instanceof RequestValidationError
            ? 'invalid_request'
            : 'internal_error';
      this.trace({
        event: 'protocol.request.failed',
        traceId,
        protocolRequestId: request.id,
        method: request.method,
        status: 'error',
        code,
        durationMs: Date.now() - startedAt,
      });
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
        this.cancelInteractions(turnId);
        await this.finishOnce(turnId, () => this.lifecycle.interruptTurn(turn.threadId, turnId));
      }),
    );
    await Promise.allSettled(active.map(([, { task }]) => task));
  }

  private async dispatch(request: ProtocolRequest, traceId: string): Promise<unknown> {
    switch (request.method) {
      case 'initialize':
        return this.lifecycle.initialize();
      case 'config/diagnostics':
        if (!this.options.configDiagnostics) {
          throw new RequestValidationError('Configuration diagnostics are not available');
        }
        return this.options.configDiagnostics(requiredString(request.params, 'cwd'));
      case 'diagnostics/export':
        if (!this.options.diagnosticExport) {
          throw new RequestValidationError('Diagnostic export is not available');
        }
        return this.options.diagnosticExport(requiredString(request.params, 'cwd'));
      case 'workspace/diff': {
        if (!this.options.workspaceDiff) {
          throw new RequestValidationError('Workspace diff is not available');
        }
        const thread = await this.lifecycle.resumeThread(requiredId(request.params, 'threadId'));
        return this.options.workspaceDiff(thread.cwd);
      }
      case 'review/apply':
        return this.applyReviewFindings(request.params, traceId);
      case 'review/revert':
        return this.revertReviewAction(request.params, traceId);
      case 'thread/start':
        return this.lifecycle.startThread(requiredString(request.params, 'cwd'), traceId);
      case 'thread/read':
        return this.lifecycle.readThread(requiredId(request.params, 'threadId'));
      case 'thread/resume':
        return this.resumeThread(requiredId(request.params, 'threadId'));
      case 'thread/list':
        return this.lifecycle.listThreads();
      case 'thread/fork':
        return this.lifecycle.forkThread(requiredId(request.params, 'threadId'), traceId);
      case 'thread/archive':
        return this.lifecycle.archiveThread(requiredId(request.params, 'threadId'));
      case 'turn/start':
        return this.startTurn(request.params, traceId);
      case 'turn/interrupt':
        return this.interruptTurn(request.params);
      case 'approval/respond':
        return this.respondToApproval(request.params);
      case 'user-input/respond':
        return this.respondToUserInput(request.params);
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

  private async applyReviewFindings(
    params: Record<string, unknown>,
    traceId: string,
  ): Promise<TurnSnapshot> {
    const threadId = requiredId(params, 'threadId');
    const findingIds = requiredIds(params, 'findingIds', 20);
    const thread = await this.lifecycle.resumeThread(threadId);
    const findings = new Map<string, ReviewFindingPayload>();
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        if (item.type === 'review_finding' && isReviewFindingPayload(item.payload)) {
          findings.set(item.payload.findingId, item.payload);
        }
      }
    }
    const selected = findingIds.map((findingId) => {
      const finding = findings.get(findingId);
      if (!finding) throw new RequestValidationError(`Review finding not found: ${findingId}`);
      return finding;
    });
    const action: ReviewActionRequest = { kind: 'apply', findingIds };
    return this.startTurn(
      {
        threadId,
        input: { text: reviewApplyManyPrompt(selected), reviewAction: action },
      },
      traceId,
      action,
    );
  }

  private async revertReviewAction(
    params: Record<string, unknown>,
    traceId: string,
  ): Promise<TurnSnapshot> {
    const threadId = requiredId(params, 'threadId');
    const sourceActionId = requiredId(params, 'actionId');
    const thread = await this.lifecycle.resumeThread(threadId);
    const sourceTurn = thread.turns.find((turn) => turn.id === sourceActionId);
    if (!sourceTurn || sourceTurn.status !== 'completed') {
      throw new RequestValidationError(`Completed review action not found: ${sourceActionId}`);
    }
    const sourceAction = sourceTurn.items
      .filter((item) => item.type === 'review_action')
      .map((item) => item.payload)
      .find(isApplyReviewAction);
    if (!sourceAction || sourceAction.actionId !== sourceActionId) {
      throw new RequestValidationError(`Applied review action not found: ${sourceActionId}`);
    }
    const action: ReviewActionRequest = {
      kind: 'revert',
      sourceActionId,
      findingIds: sourceAction.findingIds,
    };
    return this.startTurn(
      {
        threadId,
        input: {
          text: reviewRevertPrompt(sourceActionId, sourceAction.findingIds),
          reviewAction: action,
        },
      },
      traceId,
      action,
    );
  }

  private async startTurn(
    params: Record<string, unknown>,
    traceId: string,
    reviewAction?: ReviewActionRequest,
  ): Promise<TurnSnapshot> {
    const threadId = requiredId(params, 'threadId');
    const input = requiredRecord(params, 'input');
    if (!reviewAction && Object.hasOwn(input, 'reviewAction')) {
      throw new RequestValidationError('reviewAction is reserved for app-server review methods');
    }
    const thread = await this.lifecycle.resumeThread(threadId);
    const turn = await this.lifecycle.startTurn(threadId, input, traceId);
    if (reviewAction) {
      await this.lifecycle.appendCompletedItem(threadId, turn.id, 'review_action', {
        actionId: turn.id,
        ...reviewAction,
      });
    }
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
    this.cancelInteractions(turnId);
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
    const traceId = turn.traceId ?? this.newTraceId();
    const startedAt = Date.now();
    this.trace({
      event: 'turn.execution.started',
      traceId,
      threadId: thread.id,
      turnId: turn.id,
      status: 'in_progress',
    });
    try {
      const result = await this.options.executor.execute({
        thread,
        turn,
        input,
        signal: controller.signal,
        publishDelta: (itemId, delta) => {
          this.lifecycle.publishDelta({
            traceId,
            threadId: thread.id,
            turnId: turn.id,
            itemId,
            delta,
          });
        },
        publishReasoning: (itemId, delta) => {
          this.lifecycle.publishReasoning({
            traceId,
            threadId: thread.id,
            turnId: turn.id,
            itemId,
            delta,
          });
        },
        publishToolStarted: (itemId, name, input) => {
          this.options.onEvent?.({
            type: 'tool.started',
            traceId,
            threadId: thread.id,
            turnId: turn.id,
            itemId,
            name,
            input,
          });
        },
        publishToolCompleted: (itemId, result) => {
          this.options.onEvent?.({
            type: 'tool.completed',
            traceId,
            threadId: thread.id,
            turnId: turn.id,
            itemId,
            result,
          });
        },
        publishUsage: (usage) => {
          this.options.onEvent?.({
            type: 'usage.updated',
            traceId,
            threadId: thread.id,
            turnId: turn.id,
            usage,
          });
        },
        requestApproval: (toolName, reason) =>
          this.requestApproval(traceId, thread.id, turn.id, toolName, reason),
        requestUserInput: (request) => this.requestUserInput(traceId, thread.id, turn.id, request),
      });
      if (controller.signal.aborted) {
        await this.finishOnce(turn.id, () => this.lifecycle.interruptTurn(thread.id, turn.id));
        this.trace({
          event: 'turn.execution.completed',
          traceId,
          threadId: thread.id,
          turnId: turn.id,
          status: 'interrupted',
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      for (const item of result.items ?? []) {
        await this.lifecycle.appendCompletedItem(thread.id, turn.id, item.type, item.payload);
      }
      if (result.status === 'failed') {
        await this.finishOnce(turn.id, () => this.lifecycle.failTurn(thread.id, turn.id));
        this.trace({
          event: 'turn.execution.completed',
          traceId,
          threadId: thread.id,
          turnId: turn.id,
          status: 'failed',
          durationMs: Date.now() - startedAt,
        });
      } else {
        await this.finishOnce(turn.id, () => this.lifecycle.completeTurn(thread.id, turn.id));
        this.trace({
          event: 'turn.execution.completed',
          traceId,
          threadId: thread.id,
          turnId: turn.id,
          status: 'completed',
          durationMs: Date.now() - startedAt,
        });
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
      const interrupted = controller.signal.aborted || (error as Error).name === 'AbortError';
      this.trace({
        event: interrupted ? 'turn.execution.completed' : 'turn.execution.failed',
        traceId,
        threadId: thread.id,
        turnId: turn.id,
        status: interrupted ? 'interrupted' : 'failed',
        code: errorCode(error),
        durationMs: Date.now() - startedAt,
      });
    } finally {
      this.cancelInteractions(turn.id);
      this.activeTurns.delete(turn.id);
    }
  }

  private requestApproval(
    traceId: string,
    threadId: string,
    turnId: string,
    toolName: string,
    reason: string,
  ): Promise<'allow' | 'deny' | 'always'> {
    const requestId = this.nextInteractionId();
    const response = new Promise<'allow' | 'deny' | 'always'>((resolve) => {
      this.pendingInteractions.set(requestId, {
        kind: 'approval',
        threadId,
        turnId,
        resolve,
      });
    });
    this.options.onEvent?.({
      type: 'approval.requested',
      traceId,
      threadId,
      turnId,
      requestId,
      toolName,
      reason,
    });
    return response;
  }

  private requestUserInput(
    traceId: string,
    threadId: string,
    turnId: string,
    request: {
      question: string;
      options: Array<{ label: string; description: string }>;
      multiSelect?: boolean;
    },
  ): Promise<string> {
    const requestId = this.nextInteractionId();
    const response = new Promise<string>((resolve) => {
      this.pendingInteractions.set(requestId, {
        kind: 'user-input',
        threadId,
        turnId,
        resolve,
      });
    });
    this.options.onEvent?.({
      type: 'user-input.requested',
      traceId,
      threadId,
      turnId,
      requestId,
      ...request,
    });
    return response;
  }

  private respondToApproval(params: Record<string, unknown>): { accepted: true } {
    const interaction = this.requireInteraction(params, 'approval');
    const decision = requiredString(params, 'decision');
    if (decision !== 'allow' && decision !== 'deny' && decision !== 'always') {
      throw new RequestValidationError('decision is invalid');
    }
    this.pendingInteractions.delete(requiredId(params, 'requestId'));
    interaction.resolve(decision);
    return { accepted: true };
  }

  private respondToUserInput(params: Record<string, unknown>): { accepted: true } {
    const interaction = this.requireInteraction(params, 'user-input');
    const answer = requiredString(params, 'answer');
    this.pendingInteractions.delete(requiredId(params, 'requestId'));
    interaction.resolve(answer);
    return { accepted: true };
  }

  private requireInteraction<K extends PendingInteraction['kind']>(
    params: Record<string, unknown>,
    kind: K,
  ): Extract<PendingInteraction, { kind: K }> {
    const requestId = requiredId(params, 'requestId');
    const threadId = requiredId(params, 'threadId');
    const turnId = requiredId(params, 'turnId');
    const interaction = this.pendingInteractions.get(requestId);
    if (!interaction || interaction.kind !== kind) {
      throw new RequestValidationError(`Pending ${kind} request not found: ${requestId}`);
    }
    if (interaction.threadId !== threadId || interaction.turnId !== turnId) {
      throw new RequestValidationError(
        `Request ${requestId} does not belong to ${threadId}/${turnId}`,
      );
    }
    return interaction as Extract<PendingInteraction, { kind: K }>;
  }

  private cancelInteractions(turnId: string): void {
    for (const [requestId, interaction] of this.pendingInteractions) {
      if (interaction.turnId !== turnId) continue;
      this.pendingInteractions.delete(requestId);
      if (interaction.kind === 'approval') interaction.resolve('deny');
      else interaction.resolve('');
    }
  }

  private nextInteractionId(): string {
    return `request-${Date.now().toString(36)}-${++this.interactionSequence}`;
  }

  private trace(record: AppServerTraceRecord): void {
    try {
      this.options.onTrace?.(record);
    } catch {
      // Observability must never change protocol or execution behavior.
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

function errorCode(error: unknown): string {
  if (error instanceof ProtocolInvariantError) return 'invalid_state';
  if (error instanceof RequestValidationError) return 'invalid_request';
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  return 'internal_error';
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
  if (value.length > 200 || !/^[a-zA-Z0-9._-]+$/.test(value)) {
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

function requiredIds(params: Record<string, unknown>, key: string, maximum: number): string[] {
  const value = params[key];
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new RequestValidationError(`${key} must contain between 1 and ${maximum} ids`);
  }
  const ids = value.map((entry) => {
    if (typeof entry !== 'string' || !/^[a-zA-Z0-9._-]{1,200}$/.test(entry)) {
      throw new RequestValidationError(`${key} contains an invalid id`);
    }
    return entry;
  });
  if (new Set(ids).size !== ids.length) {
    throw new RequestValidationError(`${key} must not contain duplicate ids`);
  }
  return ids;
}

function isApplyReviewAction(value: Record<string, unknown>): value is ReviewActionPayload & {
  kind: 'apply';
} {
  return (
    value.kind === 'apply' &&
    typeof value.actionId === 'string' &&
    Array.isArray(value.findingIds) &&
    value.findingIds.length > 0 &&
    value.findingIds.length <= 20 &&
    new Set(value.findingIds).size === value.findingIds.length &&
    value.findingIds.every(
      (findingId) => typeof findingId === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(findingId),
    )
  );
}
