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
  /** In-flight turn controllers so /abort cancels provider and tools. */
  activeTurns: Map<string, AbortController>;
}

const state: ServerState = {
  initialized: false,
  activeTurns: new Map(),
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

async function handleExecuteCommand(params: ExecuteCommandParams, send: SendFn): Promise<unknown> {
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
  args: { prompt?: string; model?: string },
  send: SendFn,
): Promise<{ turnId: string }> {
  if (!args.prompt) throw new Error('prompt is required');
  const turnId = `lsp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const abortController = new AbortController();
  state.activeTurns.set(turnId, abortController);

  // Stream events back via JSON-RPC notifications.
  // Wired to the real agent loop — same code that drives the CLI / Mac client.
  send({
    jsonrpc: '2.0',
    method: 'deepcode/agentEvent',
    params: { turnId, kind: 'started', prompt: args.prompt },
  });

  // Run async; we return turnId immediately so the LSP client can
  // call deepcode.abort while it's in-flight.
  void (async () => {
    try {
      const [
        { RuntimeHost },
        { DeepSeekProvider },
        { ToolRegistry, BUILTIN_TOOLS, SAFE_READONLY_TOOLS },
        { resolveCredentials, CredentialsStore },
      ] = await Promise.all([
        import('@deepcode/core').then((m) => ({ RuntimeHost: m.RuntimeHost })),
        import('@deepcode/core').then((m) => ({ DeepSeekProvider: m.DeepSeekProvider })),
        import('@deepcode/core').then((m) => ({
          ToolRegistry: m.ToolRegistry,
          BUILTIN_TOOLS: m.BUILTIN_TOOLS,
          SAFE_READONLY_TOOLS: m.SAFE_READONLY_TOOLS,
        })),
        import('@deepcode/core').then((m) => ({
          resolveCredentials: m.resolveCredentials,
          CredentialsStore: m.CredentialsStore,
        })),
      ]);

      const creds = await resolveCredentials({ store: new CredentialsStore() });
      if (!creds.apiKey && !creds.authToken) {
        throw new Error(
          'No DeepSeek credentials. Run `deepcode` once to onboard, or set DEEPSEEK_API_KEY.',
        );
      }

      const provider = new DeepSeekProvider({
        apiKey: creds.apiKey ?? '',
        authToken: creds.authToken,
        baseURL: creds.baseURL,
      });

      const runtime = new RuntimeHost({
        provider,
        tools: new ToolRegistry(BUILTIN_TOOLS),
        cwd: state.rootUri ? new URL(state.rootUri).pathname : process.cwd(),
        mode: 'default',
        permissions: { allow: [...SAFE_READONLY_TOOLS] },
      });
      const result = await runtime.run({
        systemPrompt: 'You are DeepCode, an AI coding assistant powered by DeepSeek. Be concise.',
        userMessage: args.prompt!,
        model: args.model ?? 'deepseek-chat',
        signal: abortController.signal,
        onEvent: (e) => {
          send({
            jsonrpc: '2.0',
            method: 'deepcode/agentEvent',
            params: { turnId, kind: e.type, ...e },
          });
        },
      });

      send({
        jsonrpc: '2.0',
        method: 'deepcode/agentEvent',
        params: { turnId, kind: 'turn_done', stopReason: result.stopReason },
      });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        method: 'deepcode/agentEvent',
        params: {
          turnId,
          kind: 'error',
          error: (err as Error).message ?? String(err),
        },
      });
      send({
        jsonrpc: '2.0',
        method: 'deepcode/agentEvent',
        params: { turnId, kind: 'turn_done', stopReason: 'error' },
      });
    } finally {
      state.activeTurns.delete(turnId);
    }
  })();

  return { turnId };
}

function handleAbort(args: { turnId?: string }): { aborted: boolean } {
  if (!args.turnId) throw new Error('turnId is required');
  const controller = state.activeTurns.get(args.turnId);
  if (!controller) return { aborted: false };
  controller.abort();
  return { aborted: true };
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
