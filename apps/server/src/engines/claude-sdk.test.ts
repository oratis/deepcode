import { getEventListeners } from 'node:events';
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSdkMcpServer,
  type Options,
  type Query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  RuntimeHost,
  SessionManager,
  ToolRegistry,
  WriteTool,
  HookDispatcher,
} from '@deepcode/core';
import { CredentialsStore } from '@deepcode/core/credentials';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeSdkEngine, configuredEngine } from './claude-sdk.js';

describe('Claude SDK engine boundary', () => {
  let cwd: string;
  let store: CredentialsStore;
  let observed: Options;
  let body: (client: Client) => Promise<void>;
  let closed: boolean;
  let stopReason: string;
  let failAfterResult: boolean;
  let failSetup: boolean;
  let failClose: boolean;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-sdk-test-'));
    store = new CredentialsStore({ directory: join(cwd, 'credentials'), forceFile: true });
    closed = false;
    failAfterResult = false;
    failSetup = false;
    failClose = false;
    stopReason = 'end_turn';
    body = async () => {};
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  function engine() {
    return new ClaudeSdkEngine({
      settings: {},
      store,
      env: { MOONSHOT_API_KEY: 'fake-moon' },
      loadSdk: async () => ({
        createSdkMcpServer: (options) => {
          if (failSetup) throw new Error('MCP setup failed');
          return createSdkMcpServer(options);
        },
        query: ({ options }) => {
          observed = options!;
          const generator = (async function* () {
            const client = new Client({ name: 'test', version: '1' });
            const [a, b] = InMemoryTransport.createLinkedPair();
            const config = options!.mcpServers!.deepcode;
            if (!config || config.type !== 'sdk') throw new Error('Missing bridge');
            await Promise.all([client.connect(a), config.instance.connect(b)]);
            try {
              yield {
                type: 'system',
                subtype: 'init',
                session_id: '12345678-1234-1234-1234-123456789012',
              } as SDKMessage;
              await body(client);
              yield {
                type: 'assistant',
                message: { content: [{ type: 'text', text: 'done' }] },
              } as SDKMessage;
              yield {
                type: 'result',
                subtype: 'success',
                is_error: false,
                stop_reason: stopReason,
                num_turns: 1,
                usage: { input_tokens: 5, output_tokens: 2 },
                session_id: '12345678-1234-1234-1234-123456789012',
              } as SDKMessage;
              if (failAfterResult) throw new Error('Transport failed after result');
            } finally {
              await client.close();
            }
          })();
          return Object.assign(generator, {
            close: () => {
              closed = true;
              if (failClose) throw new Error('SDK query close failed');
            },
          }) as Query;
        },
      }),
    });
  }
  const provider = {
    name: 'unused',
    runTurn: async () => {
      throw new Error('Native loop must not run');
    },
  };
  function host(mode: 'default' | 'plan' | 'bypassPermissions' = 'default') {
    return new RuntimeHost({
      engine: engine(),
      provider,
      tools: new ToolRegistry([WriteTool]),
      cwd,
      mode,
      disableLedger: true,
    });
  }
  const turn = {
    model: 'kimi-k2.5',
    systemPrompt: 'test',
    userMessage: 'test',
    systemReminders: false,
  };
  it('keeps native as the explicit rollback and never loads SDK by default', () => {
    expect(configuredEngine({}, store)).toBeUndefined();
    expect(configuredEngine({ engine: 'native' }, store)).toBeUndefined();
  });
  it.each(['setup', 'close'] as const)('cleans up when SDK %s fails', async (stage) => {
    failSetup = stage === 'setup';
    failClose = stage === 'close';
    const controller = new AbortController();
    const result = await host().run({ ...turn, signal: controller.signal });
    expect(result.stopReason).toBe('error');
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    if (stage === 'close') {
      expect(closed).toBe(true);
      await expect(access(observed.env!.CLAUDE_CONFIG_DIR!)).rejects.toThrow();
    }
  });
  it('does not report success if the SDK stream subsequently fails', async () => {
    failAfterResult = true;
    expect((await host().run(turn)).stopReason).toBe('error');
  });
  it.each(['missing', 'future-version'] as const)(
    'preserves history when the SDK binding is %s',
    async (failure) => {
      const manager = new SessionManager({ root: join(cwd, 'sessions') });
      const session = await manager.create(cwd);
      const first = await host().run({ ...turn, session: { manager, id: session.id } });
      const bindingPath = join(manager.root, session.id, 'claude-sdk', 'binding.json');
      if (failure === 'missing') await rm(bindingPath);
      else {
        const binding = JSON.parse(await readFile(bindingPath, 'utf8'));
        await writeFile(bindingPath, JSON.stringify({ ...binding, version: 99 }));
      }
      await expect(
        host().run({ ...turn, history: first.history, session: { manager, id: session.id } }),
      ).rejects.toThrow(failure === 'missing' ? 'binding is missing' : 'binding version');
      expect((await manager.load(session.id))?.messages).toEqual(first.history);
    },
  );
  it('ignores unsupported hook types when all hooks are explicitly disabled', async () => {
    const runtime = new RuntimeHost({
      engine: engine(),
      provider,
      tools: new ToolRegistry(),
      cwd,
      hooks: new HookDispatcher({
        disableAllHooks: true,
        hooks: { PreToolUse: [{ hooks: [{ type: 'agent', agent: 'judge' }] }] },
      }),
    });
    expect((await runtime.run(turn)).stopReason).toBe('end_turn');
  });
  it('refuses to reinterpret an on-disk native session even when the caller omits history', async () => {
    const manager = new SessionManager({ root: join(cwd, 'sessions') });
    const session = await manager.create(cwd);
    await manager.append(session.id, {
      role: 'user',
      content: [{ type: 'text', text: 'native history' }],
    });
    await expect(host().run({ ...turn, session: { manager, id: session.id } })).rejects.toThrow(
      'Existing native history',
    );
    expect((await manager.load(session.id))?.messages).toHaveLength(1);
  });
  it('rejects unsupported hooks instead of silently ignoring a configured gate', async () => {
    const runtime = new RuntimeHost({
      engine: engine(),
      provider,
      tools: new ToolRegistry(),
      cwd,
      hooks: new HookDispatcher({
        hooks: { PreToolUse: [{ hooks: [{ type: 'agent', agent: 'judge' }] }] },
      }),
    });
    await expect(runtime.run(turn)).rejects.toThrow('does not support agent hooks');
  });
  it('preserves SDK truncation even when the result subtype says success', async () => {
    stopReason = 'max_tokens';
    expect((await host().run(turn)).stopReason).toBe('max_tokens');
  });
  it('disables SDK built-ins and ambient settings, uses only scoped credentials', async () => {
    await host().run(turn);
    expect(observed.tools).toEqual([]);
    expect(observed.settingSources).toEqual([]);
    expect(observed.strictMcpConfig).toBe(true);
    expect(observed.plugins).toEqual([]);
    expect(observed.env?.ANTHROPIC_AUTH_TOKEN).toBe('fake-moon');
    expect(observed.env?.DEEPSEEK_API_KEY).toBeUndefined();
    expect(observed.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(closed).toBe(true);
  });
  it('refuses writes in plan mode even with an approval callback', async () => {
    body = async (client) => {
      const r = await client.callTool({
        name: 'Write',
        arguments: { file_path: 'no.txt', content: 'no' },
      });
      expect(r.isError).toBe(true);
    };
    await host('plan').run({ ...turn, approval: async () => true });
    await expect(access(join(cwd, 'no.txt'))).rejects.toThrow();
  });
  it('honors denial and does not execute a queued write', async () => {
    body = async (client) => {
      const r = await client.callTool({
        name: 'Write',
        arguments: { file_path: 'no.txt', content: 'no' },
      });
      expect(r.isError).toBe(true);
    };
    await host().run({ ...turn, approval: async () => false });
    await expect(access(join(cwd, 'no.txt'))).rejects.toThrow();
  });
  it('writes through the native gate and refuses symlink escape', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dc-sdk-outside-'));
    try {
      await symlink(outside, join(cwd, 'escape'));
      body = async (client) => {
        expect(
          (
            await client.callTool({
              name: 'Write',
              arguments: { file_path: 'yes.txt', content: 'yes' },
            })
          ).isError,
        ).toBe(false);
        expect(
          (
            await client.callTool({
              name: 'Write',
              arguments: { file_path: 'escape/no.txt', content: 'no' },
            })
          ).isError,
        ).toBe(true);
      };
      const result = await host('bypassPermissions').run(turn);
      expect(
        result.history.some((message) =>
          message.content.some((block) => block.type === 'tool_use'),
        ),
      ).toBe(true);
      expect(
        result.history.some((message) =>
          message.content.some((block) => block.type === 'tool_result'),
        ),
      ).toBe(true);
      expect(await readFile(join(cwd, 'yes.txt'), 'utf8')).toBe('yes');
      await expect(access(join(outside, 'no.txt'))).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
  it('resumes its SDK session and rejects switching engines in place', async () => {
    const manager = new SessionManager({ root: join(cwd, 'sessions') });
    const session = await manager.create(cwd);
    const first = await host().run({ ...turn, session: { manager, id: session.id } });
    await host().run({ ...turn, history: first.history, session: { manager, id: session.id } });
    expect(observed.resume).toBe('12345678-1234-1234-1234-123456789012');
    await expect(
      host().run({ ...turn, model: 'kimi-custom', session: { manager, id: session.id } }),
    ).rejects.toThrow('SDK connection changed');
    const native = new RuntimeHost({ provider, tools: new ToolRegistry([]), cwd });
    await expect(native.run({ ...turn, session: { manager, id: session.id } })).rejects.toThrow(
      'Start a new session',
    );
  });
  it('cancels pending approval and drains tool work before returning', async () => {
    const ac = new AbortController();
    body = async (client) => {
      await client.callTool({ name: 'Write', arguments: { file_path: 'late', content: 'late' } });
    };
    const result = await host().run({
      ...turn,
      signal: ac.signal,
      approval: async () => {
        ac.abort();
        return new Promise(() => {});
      },
    });
    expect(result.stopReason).toBe('aborted');
    await expect(access(join(cwd, 'late'))).rejects.toThrow();
  });
  it('stops an unattended run when approval policy requires abort', async () => {
    body = async (client) => {
      await client.callTool({ name: 'Write', arguments: { file_path: 'blocked', content: 'no' } });
    };
    const result = await host().run({ ...turn, unattended: true, onApprovalRequired: 'abort' });
    expect(result.stopReason).toBe('blocked');
    await expect(access(join(cwd, 'blocked'))).rejects.toThrow();
  });
});
