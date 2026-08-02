// LSP compatibility handler backed by the shared app-server protocol client.

import { fileURLToPath } from 'node:url';

import { SpawnedAppServerConnection } from '@deepcode/app-server/client';
import {
  ProtocolClient,
  type ConfigDiagnosticsResult,
  type InitializeResult,
  type ProtocolEvent,
  type ProtocolMethod,
  type ReviewFindingPayload,
  type ThreadSnapshot,
  type TurnSnapshot,
  type WorkspaceDiffResult,
} from '@deepcode/protocol';

export interface LspMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type SendFn = (msg: LspMessage) => void;

interface AppServerClient {
  connect(): Promise<InitializeResult>;
  request<T>(method: ProtocolMethod, params?: Record<string, unknown>): Promise<T>;
  subscribe(handler: (event: ProtocolEvent) => void): () => void;
  close(): Promise<void>;
}

interface ServerState {
  initialized: boolean;
  rootUri?: string;
  threadId?: string;
  client?: AppServerClient;
  unsubscribe?: () => void;
  clientFactory: () => AppServerClient;
  activeTurns: Map<string, string>;
  turnSinks: Map<string, SendFn>;
  queuedEvents: Map<string, ProtocolEvent[]>;
  latestSend?: SendFn;
}

const state: ServerState = {
  initialized: false,
  clientFactory: () => new ProtocolClient(new SpawnedAppServerConnection()),
  activeTurns: new Map(),
  turnSinks: new Map(),
  queuedEvents: new Map(),
};

const SERVER_INFO = {
  name: 'deepcode-lsp',
  version: '0.0.0',
};

const COMMANDS = [
  'deepcode.runAgent',
  'deepcode.abort',
  'deepcode.readThread',
  'deepcode.resumeThread',
  'deepcode.respondApproval',
  'deepcode.respondUserInput',
  'deepcode.listSkills',
  'deepcode.configDiagnostics',
  'deepcode.workspaceDiff',
  'deepcode.applyReviewFinding',
  'deepcode.applyReviewFindings',
];

export async function handleMessage(msg: LspMessage, send: SendFn): Promise<void> {
  if (msg.id === undefined || msg.id === null) {
    await handleNotification(msg);
    return;
  }

  try {
    const result = await dispatch(msg, send);
    send({ jsonrpc: '2.0', id: msg.id, result });
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32603, message: (error as Error).message },
    });
  }
}

async function handleNotification(msg: LspMessage): Promise<void> {
  switch (msg.method) {
    case 'initialized':
      state.initialized = true;
      return;
    case 'exit':
      await closeClient();
      process.exit(state.initialized ? 0 : 1);
      return;
    default:
      return;
  }
}

async function dispatch(msg: LspMessage, send: SendFn): Promise<unknown> {
  switch (msg.method) {
    case 'initialize':
      return handleInitialize(msg.params as { rootUri?: string });
    case 'shutdown':
      await closeClient();
      return null;
    case 'workspace/executeCommand':
      return handleExecuteCommand(msg.params as ExecuteCommandParams, send);
    default:
      throw new Error(`Method not supported: ${msg.method ?? '<missing>'}`);
  }
}

function handleInitialize(params: { rootUri?: string }): unknown {
  state.rootUri = params?.rootUri;
  return {
    capabilities: {
      executeCommandProvider: { commands: COMMANDS },
      textDocumentSync: 0,
    },
    serverInfo: SERVER_INFO,
  };
}

interface ExecuteCommandParams {
  command: string;
  arguments?: unknown[];
}

async function handleExecuteCommand(params: ExecuteCommandParams, send: SendFn): Promise<unknown> {
  state.latestSend = send;
  switch (params.command) {
    case 'deepcode.runAgent':
      return handleRunAgent(
        (params.arguments?.[0] ?? {}) as {
          prompt?: string;
          model?: string;
          effort?: string;
          mode?: string;
          threadId?: string;
        },
        send,
      );
    case 'deepcode.abort':
      return handleAbort((params.arguments?.[0] ?? {}) as { turnId?: string });
    case 'deepcode.readThread':
      return handleReadThread((params.arguments?.[0] ?? {}) as { threadId?: string });
    case 'deepcode.resumeThread':
      return handleResumeThread((params.arguments?.[0] ?? {}) as { threadId?: string });
    case 'deepcode.respondApproval':
      return handleApproval(
        (params.arguments?.[0] ?? {}) as {
          turnId?: string;
          requestId?: string;
          decision?: 'allow' | 'deny' | 'always';
        },
      );
    case 'deepcode.respondUserInput':
      return handleUserInput(
        (params.arguments?.[0] ?? {}) as {
          turnId?: string;
          requestId?: string;
          answer?: string;
        },
      );
    case 'deepcode.listSkills':
      return handleListSkills();
    case 'deepcode.configDiagnostics':
      return handleConfigDiagnostics();
    case 'deepcode.workspaceDiff':
      return handleWorkspaceDiff();
    case 'deepcode.applyReviewFinding':
      return handleReviewApply(
        [((params.arguments?.[0] ?? {}) as ReviewFindingPayload).findingId],
        send,
      );
    case 'deepcode.applyReviewFindings':
      return handleReviewApply(
        ((params.arguments?.[0] ?? {}) as { findingIds?: string[] }).findingIds ?? [],
        send,
      );
    default:
      throw new Error(`Unknown command: ${params.command}`);
  }
}

async function handleRunAgent(
  args: {
    prompt?: string;
    model?: string;
    effort?: string;
    mode?: string;
    threadId?: string;
  },
  send: SendFn,
): Promise<{ threadId: string; turnId: string }> {
  if (!args.prompt) throw new Error('prompt is required');
  const client = await getClient();
  const thread = await ensureThread(client, args.threadId);
  const turn = await client.request<TurnSnapshot>('turn/start', {
    threadId: thread.id,
    input: {
      text: args.prompt,
      ...(args.model ? { model: args.model } : {}),
      ...(args.effort ? { effort: args.effort } : {}),
      ...(args.mode ? { mode: args.mode } : {}),
    },
  });
  state.activeTurns.set(turn.id, thread.id);
  state.turnSinks.set(turn.id, send);
  flushEvents(turn.id);
  return { threadId: thread.id, turnId: turn.id };
}

async function handleReviewApply(
  findingIds: Array<string | undefined>,
  send: SendFn,
): Promise<{ threadId: string; turnId: string }> {
  if (findingIds.length === 0 || findingIds.some((findingId) => !findingId)) {
    throw new Error('At least one findingId is required');
  }
  const client = await getClient();
  const initialized = await client.connect();
  if (!initialized.capabilities.reviewActions) {
    throw new Error('The app-server does not support review actions');
  }
  const thread = await ensureThread(client);
  const turn = await client.request<TurnSnapshot>('review/apply', {
    threadId: thread.id,
    findingIds: findingIds as string[],
  });
  state.activeTurns.set(turn.id, thread.id);
  state.turnSinks.set(turn.id, send);
  flushEvents(turn.id);
  return { threadId: thread.id, turnId: turn.id };
}

async function handleAbort(args: { turnId?: string }): Promise<{ aborted: boolean }> {
  if (!args.turnId) throw new Error('turnId is required');
  const threadId = state.activeTurns.get(args.turnId);
  if (!threadId) return { aborted: false };
  const client = await getClient();
  const result = await client.request<{ interrupted: boolean }>('turn/interrupt', {
    threadId,
    turnId: args.turnId,
  });
  return { aborted: result.interrupted };
}

async function handleReadThread(args: { threadId?: string }): Promise<ThreadSnapshot> {
  if (!args.threadId) throw new Error('threadId is required');
  return (await getClient()).request<ThreadSnapshot>('thread/read', { threadId: args.threadId });
}

async function handleResumeThread(args: { threadId?: string }): Promise<ThreadSnapshot> {
  if (!args.threadId) throw new Error('threadId is required');
  const thread = await (
    await getClient()
  ).request<ThreadSnapshot>('thread/resume', {
    threadId: args.threadId,
  });
  state.threadId = thread.id;
  return thread;
}

async function handleApproval(args: {
  turnId?: string;
  requestId?: string;
  decision?: 'allow' | 'deny' | 'always';
}): Promise<{ accepted: boolean }> {
  const { threadId, turnId, requestId } = interactionContext(args);
  if (!args.decision) throw new Error('decision is required');
  return (await getClient()).request('approval/respond', {
    threadId,
    turnId,
    requestId,
    decision: args.decision,
  });
}

async function handleUserInput(args: {
  turnId?: string;
  requestId?: string;
  answer?: string;
}): Promise<{ accepted: boolean }> {
  const { threadId, turnId, requestId } = interactionContext(args);
  if (args.answer === undefined) throw new Error('answer is required');
  return (await getClient()).request('user-input/respond', {
    threadId,
    turnId,
    requestId,
    answer: args.answer,
  });
}

function interactionContext(args: { turnId?: string; requestId?: string }) {
  if (!args.turnId) throw new Error('turnId is required');
  if (!args.requestId) throw new Error('requestId is required');
  const threadId = state.activeTurns.get(args.turnId);
  if (!threadId) throw new Error(`Active turn not found: ${args.turnId}`);
  return { threadId, turnId: args.turnId, requestId: args.requestId };
}

async function getClient(): Promise<AppServerClient> {
  if (!state.client) {
    const client = state.clientFactory();
    state.client = client;
    state.unsubscribe = client.subscribe(routeEvent);
  }
  await state.client.connect();
  return state.client;
}

async function ensureThread(
  client: AppServerClient,
  requestedThreadId?: string,
): Promise<ThreadSnapshot> {
  if (requestedThreadId && requestedThreadId !== state.threadId) {
    const thread = await client.request<ThreadSnapshot>('thread/resume', {
      threadId: requestedThreadId,
    });
    state.threadId = thread.id;
    return thread;
  }
  if (state.threadId) {
    return client.request<ThreadSnapshot>('thread/read', { threadId: state.threadId });
  }
  const thread = await client.request<ThreadSnapshot>('thread/start', { cwd: workspacePath() });
  state.threadId = thread.id;
  return thread;
}

function routeEvent(event: ProtocolEvent): void {
  const turnId = turnIdFrom(event);
  if (!turnId) {
    state.latestSend?.({ jsonrpc: '2.0', method: 'deepcode/protocolEvent', params: event });
    return;
  }
  const send = state.turnSinks.get(turnId);
  if (!send) {
    const queued = state.queuedEvents.get(turnId) ?? [];
    queued.push(event);
    state.queuedEvents.set(turnId, queued);
    return;
  }
  sendProtocolEvent(send, event);
}

function flushEvents(turnId: string): void {
  const send = state.turnSinks.get(turnId);
  if (!send) return;
  const events = state.queuedEvents.get(turnId) ?? [];
  state.queuedEvents.delete(turnId);
  for (const event of events) sendProtocolEvent(send, event);
}

function sendProtocolEvent(send: SendFn, event: ProtocolEvent): void {
  send({ jsonrpc: '2.0', method: 'deepcode/protocolEvent', params: event });
  if (isTerminal(event)) {
    const turnId = event.turn.id;
    state.activeTurns.delete(turnId);
    state.turnSinks.delete(turnId);
    state.queuedEvents.delete(turnId);
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

function workspacePath(): string {
  if (!state.rootUri) return process.cwd();
  try {
    return fileURLToPath(state.rootUri);
  } catch {
    return process.cwd();
  }
}

async function closeClient(): Promise<void> {
  state.unsubscribe?.();
  state.unsubscribe = undefined;
  const client = state.client;
  state.client = undefined;
  state.threadId = undefined;
  state.activeTurns.clear();
  state.turnSinks.clear();
  state.queuedEvents.clear();
  if (client) await client.close();
}

async function handleListSkills(): Promise<{ skills: unknown[] }> {
  const { loadSkills } = await import('@deepcode/core');
  const skills = await loadSkills({ cwd: workspacePath() });
  return {
    skills: skills.map((skill) => ({
      name: skill.qualifiedName,
      description: skill.frontmatter.description,
      source: skill.source,
      path: skill.path,
    })),
  };
}

async function handleConfigDiagnostics(): Promise<ConfigDiagnosticsResult> {
  const client = await getClient();
  const initialized = await client.connect();
  if (!initialized.capabilities.configDiagnostics) {
    throw new Error('The app-server does not support configuration diagnostics');
  }
  return client.request('config/diagnostics', { cwd: workspacePath() });
}

async function handleWorkspaceDiff(): Promise<WorkspaceDiffResult> {
  const client = await getClient();
  const initialized = await client.connect();
  if (!initialized.capabilities.workspaceDiff) {
    throw new Error('The app-server does not support workspace diff');
  }
  const thread = await ensureThread(client);
  return client.request('workspace/diff', { threadId: thread.id });
}

export const __test = {
  state,
  dispatch,
  setClientFactory(factory: () => AppServerClient) {
    state.clientFactory = factory;
  },
  async reset() {
    await closeClient();
    state.initialized = false;
    state.rootUri = undefined;
    state.latestSend = undefined;
    state.clientFactory = () => new ProtocolClient(new SpawnedAppServerConnection());
  },
};
