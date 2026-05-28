// LSP message handler — dispatches JSON-RPC methods to DeepCode actions.
// Separated from server.ts for testability.

export interface LspMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type SendFn = (msg: LspMessage) => void;

interface ServerState {
  initialized: boolean;
  /** Workspace root URI from initialize. */
  rootUri?: string;
  /** In-flight turn IDs so /abort can cancel them. */
  activeTurns: Set<string>;
}

const state: ServerState = {
  initialized: false,
  activeTurns: new Set(),
};

const SERVER_INFO = {
  name: 'deepcode-lsp',
  version: '0.0.0',
};

export async function handleMessage(msg: LspMessage, send: SendFn): Promise<void> {
  // Notifications (no id) — no response expected.
  if (msg.id === undefined || msg.id === null) {
    await handleNotification(msg, send);
    return;
  }

  try {
    const result = await dispatch(msg, send);
    send({ jsonrpc: '2.0', id: msg.id, result });
  } catch (err) {
    const e = err as Error;
    send({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32603, message: e.message },
    });
  }
}

async function handleNotification(msg: LspMessage, _send: SendFn): Promise<void> {
  switch (msg.method) {
    case 'initialized':
      state.initialized = true;
      return;
    case 'exit':
      process.exit(state.initialized ? 0 : 1);
      return;
    default:
      // Silently drop unknown notifications per LSP spec
      return;
  }
}

async function dispatch(msg: LspMessage, send: SendFn): Promise<unknown> {
  switch (msg.method) {
    case 'initialize':
      return handleInitialize(msg.params as { rootUri?: string });
    case 'shutdown':
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
      // We don't implement any LSP language features; we use the protocol
      // as a transport for our custom commands.
      executeCommandProvider: {
        commands: ['deepcode.runAgent', 'deepcode.abort', 'deepcode.listSkills'],
      },
      textDocumentSync: 0,
    },
    serverInfo: SERVER_INFO,
  };
}

interface ExecuteCommandParams {
  command: string;
  arguments?: unknown[];
}

async function handleExecuteCommand(
  params: ExecuteCommandParams,
  send: SendFn,
): Promise<unknown> {
  switch (params.command) {
    case 'deepcode.runAgent':
      return handleRunAgent((params.arguments?.[0] ?? {}) as { prompt?: string }, send);
    case 'deepcode.abort':
      return handleAbort((params.arguments?.[0] ?? {}) as { turnId?: string });
    case 'deepcode.listSkills':
      return handleListSkills();
    default:
      throw new Error(`Unknown command: ${params.command}`);
  }
}

async function handleRunAgent(
  args: { prompt?: string },
  send: SendFn,
): Promise<{ turnId: string }> {
  if (!args.prompt) throw new Error('prompt is required');
  const turnId = `lsp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  state.activeTurns.add(turnId);

  // Real impl: spawn @deepcode/core's runAgent + stream events back via
  // notification. v1.1-rest wires it; here we emit a single ack event
  // so clients can confirm the channel.
  send({
    jsonrpc: '2.0',
    method: 'deepcode/agentEvent',
    params: { turnId, kind: 'started', prompt: args.prompt },
  });
  // Schedule a fake completion event so the channel is exercised
  setImmediate(() => {
    send({
      jsonrpc: '2.0',
      method: 'deepcode/agentEvent',
      params: {
        turnId,
        kind: 'text_delta',
        text: '(LSP-skeleton — wire runAgent in v1.1-rest)',
      },
    });
    send({
      jsonrpc: '2.0',
      method: 'deepcode/agentEvent',
      params: { turnId, kind: 'turn_done', stopReason: 'end_turn' },
    });
    state.activeTurns.delete(turnId);
  });

  return { turnId };
}

function handleAbort(args: { turnId?: string }): { aborted: boolean } {
  if (!args.turnId) throw new Error('turnId is required');
  const had = state.activeTurns.delete(args.turnId);
  return { aborted: had };
}

async function handleListSkills(): Promise<{ skills: unknown[] }> {
  // Lazy import so server.ts type-checks without @deepcode/core resolved.
  const { loadSkills } = await import('@deepcode/core');
  const skills = await loadSkills({ cwd: process.cwd() });
  return {
    skills: skills.map((s) => ({
      name: s.qualifiedName,
      description: s.frontmatter.description,
      source: s.source,
      path: s.path,
    })),
  };
}

// Test exports
export const __test = {
  state,
  dispatch,
};
