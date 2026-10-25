import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createEngineToolRunner, type AgentEngine } from '@deepcode/core/runtime';
import {
  PROVIDERS,
  modelInfo,
  resolveProviderConnection,
  validateEndpoint,
  type DeepCodeSettings,
  type RunAgentOptions,
  type RunAgentResult,
  type StoredMessage,
} from '@deepcode/core';
import { CredentialsStore } from '@deepcode/core/credentials';
import type { Query, Options } from '@anthropic-ai/claude-agent-sdk';

type Sdk = Pick<typeof import('@anthropic-ai/claude-agent-sdk'), 'query' | 'createSdkMcpServer'>;
const BRIDGE_TOOLS = new Set([
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'AskUserQuestion',
  'SubmitReviewFinding',
  'RestoreReviewAction',
]);

/** Optional SDK runtime. The native engine does not import or execute it. */
export class ClaudeSdkEngine implements AgentEngine {
  readonly name = 'claude-sdk' as const;
  constructor(
    private readonly configuration: {
      settings: DeepCodeSettings;
      store: CredentialsStore;
      env?: NodeJS.ProcessEnv;
      loadSdk?: () => Promise<Sdk>;
    },
  ) {}
  async run(options: RunAgentOptions): Promise<RunAgentResult> {
    const unsupportedHooks =
      options.hooks?.handlerTypes().filter((type) => type !== 'command' && type !== 'http') ?? [];
    if (unsupportedHooks.length)
      throw new Error(
        `Claude SDK does not support ${unsupportedHooks.join(', ')} hooks. Select engine=native for this configuration.`,
      );
    const connection = await resolveProviderConnection(
      this.configuration,
      options.model,
      options.signal,
    );
    if (connection.id === 'deepseek')
      throw new Error('Claude SDK is experimental for Kimi/GLM. Select native for DeepSeek.');
    if (connection.profile?.baseURL && !connection.profile.anthropicURL)
      throw new Error('A custom profile requires an explicit anthropicURL for Claude SDK.');
    const endpoint = validateEndpoint(
      connection.profile?.anthropicURL ?? PROVIDERS[connection.id].anthropicURL!,
    );
    let sdk: Sdk;
    try {
      sdk = await (this.configuration.loadSdk?.() ?? import('@anthropic-ai/claude-agent-sdk'));
    } catch {
      throw new Error(
        'Claude SDK optional runtime is unavailable. Install @anthropic-ai/claude-agent-sdk@0.3.310 beside the app-server, or select engine=native.',
      );
    }
    const persistent = !!options.session;
    const directory = options.session
      ? join(options.session.manager.root, options.session.id, 'claude-sdk')
      : await mkdtemp(join(tmpdir(), 'deepcode-sdk-'));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const bindingPath = join(directory, 'binding.json');
    let resume: string | undefined;
    try {
      const binding = JSON.parse(await readFile(bindingPath, 'utf8')) as {
        version: number;
        sessionId: string;
        model: string;
        provider: string;
        endpoint: string;
      };
      if (binding.version !== 1) throw new Error('Unsupported SDK session binding version');
      if (
        binding.model !== options.model ||
        binding.provider !== connection.id ||
        binding.endpoint !== endpoint
      )
        throw new Error('SDK connection changed. Start a new session to change model or endpoint.');
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(binding.sessionId))
        throw new Error('Invalid SDK session binding');
      resume = binding.sessionId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      !resume &&
      options.session &&
      (options.history?.length ||
        (await options.session.manager.load(options.session.id))?.messages.length)
    ) {
      throw new Error(
        'SDK session binding is missing. Start a new session; existing history is preserved.',
      );
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const history: StoredMessage[] = [
      ...(options.history ?? []),
      { role: 'user', content: [{ type: 'text', text: options.userMessage ?? 'Continue' }] },
    ];
    const runner = createEngineToolRunner({
      ...options,
      onBlocked: abort,
      signal: controller.signal,
      onEvent(event) {
        // Stable UI/audit projection. The SDK's private transcript remains the resume source.
        if (event.type === 'tool_use')
          history.push({
            role: 'assistant',
            content: [{ type: 'tool_use', id: event.id, name: event.name, input: event.input }],
          });
        if (event.type === 'tool_result')
          history.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: event.id,
                content: event.result.content,
                is_error: event.result.isError,
              },
            ],
          });
        options.onEvent?.(event);
      },
    });
    const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 };
    let query: Query | undefined;
    let mcp: ReturnType<Sdk['createSdkMcpServer']> | undefined;
    let stopReason: RunAgentResult['stopReason'] = 'error';
    let turnsUsed = 0;
    try {
      const definitions = options.tools
        .definitions()
        .filter(
          (tool) =>
            BRIDGE_TOOLS.has(tool.name) &&
            (!options.allowedTools || options.allowedTools.includes(tool.name)),
        );
      const allowedNames = new Set(definitions.map((tool) => tool.name));
      mcp = sdk.createSdkMcpServer({ name: 'deepcode', version: '1.0.0', tools: [] });
      mcp.instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: definitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as { type: 'object' },
        })),
      }));
      mcp.instance.server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (!allowedNames.has(request.params.name))
          return { content: [{ type: 'text', text: 'Tool unavailable' }], isError: true };
        const result = await runner.run(
          request.params.name,
          request.params.arguments ?? {},
          randomUUID(),
        );
        return {
          content: [{ type: 'text', text: result.content }],
          isError: result.isError ?? false,
        };
      });
      const environment: Record<string, string> = {
        PATH: process.env.PATH ?? '',
        HOME: directory,
        CLAUDE_CONFIG_DIR: directory,
        TMPDIR: tmpdir(),
        LANG: 'en_US.UTF-8',
        ANTHROPIC_BASE_URL: endpoint,
        ANTHROPIC_AUTH_TOKEN: connection.apiKey,
        ANTHROPIC_MODEL: options.model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: options.model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: options.model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: options.model,
        CLAUDE_CODE_SUBAGENT_MODEL: options.model,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(
          Math.min(
            options.maxTokens ?? 8192,
            connection.profile?.maxOutput ?? modelInfo(options.model)?.maxOutput ?? 8192,
          ),
        ),
      };
      const sdkOptions: Options = {
        cwd: options.cwd,
        model: options.model,
        systemPrompt: options.systemPrompt,
        tools: [],
        settingSources: [],
        plugins: [],
        strictMcpConfig: true,
        permissionMode: 'default',
        allowedTools: [],
        // SDK approval only routes the call. The bridge always enforces DeepCode policy.
        canUseTool: async (name, input) =>
          name.startsWith('mcp__deepcode__') &&
          allowedNames.has(name.slice('mcp__deepcode__'.length))
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'Only DeepCode gated tools are available' },
        mcpServers: { deepcode: mcp },
        env: environment,
        maxTurns: options.maxTurns ?? 20,
        abortController: controller,
        persistSession: persistent,
        resume,
        includePartialMessages: true,
        verbatimPrompts: true,
      };
      controller.signal.throwIfAborted();
      query = sdk.query({ prompt: options.userMessage ?? 'Continue', options: sdkOptions });
      for await (const message of query) {
        if (controller.signal.aborted) break;
        if (message.type === 'system' && message.subtype === 'init' && persistent) {
          const temporary = `${bindingPath}.${randomUUID()}.tmp`;
          await writeFile(
            temporary,
            JSON.stringify({
              version: 1,
              sessionId: message.session_id,
              provider: connection.id,
              model: options.model,
              endpoint,
            }),
            { mode: 0o600 },
          );
          if (controller.signal.aborted) {
            await rm(temporary, { force: true });
            break;
          }
          await rename(temporary, bindingPath);
        } else if (
          message.type === 'stream_event' &&
          message.event.type === 'content_block_delta'
        ) {
          const delta = message.event.delta;
          if (delta.type === 'text_delta')
            options.onEvent?.({ type: 'text_delta', text: delta.text });
          if (delta.type === 'thinking_delta')
            options.onEvent?.({ type: 'thinking_delta', text: delta.thinking });
        } else if (message.type === 'assistant') {
          const content = message.message.content
            .filter((block) => block.type === 'text')
            .map((block) => ({
              type: 'text' as const,
              text: block.type === 'text' ? block.text : '',
            }));
          if (content.length) history.push({ role: 'assistant', content });
        } else if (message.type === 'result') {
          turnsUsed = message.num_turns;
          usage.inputTokens =
            message.usage.input_tokens +
            (message.usage.cache_read_input_tokens ?? 0) +
            (message.usage.cache_creation_input_tokens ?? 0);
          usage.outputTokens = message.usage.output_tokens;
          usage.cacheReadTokens = message.usage.cache_read_input_tokens ?? 0;
          stopReason =
            message.subtype === 'success' && !message.is_error
              ? message.stop_reason === 'max_tokens'
                ? 'max_tokens'
                : message.stop_reason === 'stop_sequence'
                  ? 'stop_sequence'
                  : message.stop_reason === 'refusal'
                    ? 'blocked'
                    : 'end_turn'
              : message.subtype === 'error_max_turns'
                ? 'max_turns'
                : 'error';
          if (stopReason === 'error')
            options.onEvent?.({ type: 'error', error: `Claude SDK stopped: ${message.subtype}` });
        }
      }
    } catch (error) {
      stopReason = 'error';
      if (!controller.signal.aborted)
        options.onEvent?.({
          type: 'error',
          error: `Claude SDK request failed: ${(error as Error).name}`,
        });
    } finally {
      // Stop and drain all tool work even if the SDK fails during setup or close.
      const cancelled = controller.signal.aborted;
      controller.abort();
      try {
        query?.close();
      } catch {
        stopReason = 'error';
        options.onEvent?.({ type: 'error', error: 'Claude SDK failed to close its query' });
      }
      await runner.drain();
      try {
        await mcp?.instance.close();
      } catch {
        stopReason = 'error';
        options.onEvent?.({ type: 'error', error: 'Claude SDK failed to close its tool bridge' });
      }
      options.signal?.removeEventListener('abort', abort);
      if (cancelled || options.signal?.aborted) stopReason = 'aborted';
      if (runner.blocked && !options.signal?.aborted) stopReason = 'blocked';
      if (!persistent) await rm(directory, { recursive: true, force: true });
    }
    if (options.session && options.persistSessionMessages !== false && stopReason !== 'aborted') {
      for (const message of history.slice(options.history?.length ?? 0)) {
        if (options.signal?.aborted) {
          stopReason = 'aborted';
          break;
        }
        await options.session.manager.append(options.session.id, message);
      }
    }
    await options.hooks?.dispatch({
      event: 'Stop',
      cwd: options.cwd,
      signal: options.signal,
      triggeredAt: new Date().toISOString(),
      payload: { stopReason, turnsUsed },
    });
    if (options.signal?.aborted) stopReason = 'aborted';
    options.onEvent?.({ type: 'usage', ...usage });
    options.onEvent?.({ type: 'turn_complete', stopReason, message: history.at(-1) });
    return { history, turnsUsed, usage, stopReason };
  }
}

export function configuredEngine(
  settings: DeepCodeSettings,
  store: CredentialsStore,
): AgentEngine | undefined {
  if (settings.engine === undefined || settings.engine === 'native') return undefined;
  if (settings.engine !== 'claude-sdk') throw new Error('Unknown Agent engine');
  return new ClaudeSdkEngine({ settings, store });
}
