import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfiguredProvider, resolveProviderConnection, validateEndpoint } from './configured.js';
import { CredentialsStore } from '../credentials/index.js';
import { resolveCredentials } from '../credentials/index.js';
import { gateUntrustedSettings } from '../config/trust-gate.js';
import { modelParameters } from './catalog.js';
import type { ProviderRunOpts } from './types.js';

describe('multi-provider wire and credential isolation', () => {
  let directory: string;
  let store: CredentialsStore;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dc-providers-'));
    store = new CredentialsStore({ directory, forceFile: true });
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const opts: ProviderRunOpts = { model: 'kimi-k2.5', systemPrompt: '', tools: [], messages: [] };
  it('never sends the legacy key or URL to another provider', async () => {
    await store.save({ apiKey: 'legacy', baseURL: 'https://legacy.invalid/v1' });
    await expect(
      resolveProviderConnection({ settings: {}, store, env: {} }, 'kimi-k2.5'),
    ).rejects.toThrow('MOONSHOT_API_KEY');
    const c = await resolveProviderConnection(
      { settings: {}, store, env: { MOONSHOT_API_KEY: 'moon' } },
      'kimi-k2.5',
    );
    expect(c.apiKey).toBe('moon');
    expect(c.baseURL).toBe('https://api.moonshot.cn/v1');
  });
  it('resolves the legacy environment key without writing a credential file', async () => {
    const c = await resolveProviderConnection({
      settings: {},
      store,
      env: { DEEPSEEK_API_KEY: 'environment' },
    });
    expect(c.apiKey).toBe('environment');
    expect(await store.load()).toEqual({});
  });
  it('rejects unsafe endpoints before any request', () => {
    for (const url of [
      'http://evil.invalid/v1',
      'https://user:key@host/v1',
      'https://host/v1?key=secret',
      'file:///tmp/key',
    ]) {
      expect(() => validateEndpoint(url)).toThrow();
    }
    expect(validateEndpoint('http://127.0.0.1:1234/v1/')).toBe('http://127.0.0.1:1234/v1');
  });
  it.each(['kimi-k2.5', 'glm-4.7'])(
    'streams and replays reasoning only to its originating model: %s',
    async (model) => {
      const requests: Array<{ url: string; headers: Headers; body: Record<string, any> }> = [];
      let count = 0;
      const fetcher: typeof fetch = async (url, init) => {
        requests.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        const chunks =
          count++ === 0
            ? [
                { choices: [{ delta: { reasoning_content: 'private continuation' } }] },
                {
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: 'tool1',
                            function: { name: 'Read', arguments: '{"file_path":' },
                          },
                        ],
                      },
                    },
                  ],
                },
                {
                  choices: [
                    {
                      delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] },
                      finish_reason: 'tool_calls',
                    },
                  ],
                },
              ]
            : [
                {
                  choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }],
                  usage: {
                    prompt_tokens: 20,
                    completion_tokens: 4,
                    prompt_tokens_details: { cached_tokens: 10 },
                  },
                },
              ];
        return new Response(
          chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      };
      const p = new ConfiguredProvider({
        settings: {},
        store,
        env: { MOONSHOT_API_KEY: 'moon', GLM_API_KEY: 'glm' },
        fetch: fetcher,
      });
      const first = await p.runTurn({ ...opts, model });
      expect(first.stopReason).toBe('tool_use');
      const messages = [
        { role: 'assistant' as const, content: first.content },
        {
          role: 'user' as const,
          content: [{ type: 'tool_result' as const, tool_use_id: 'tool1', content: 'file' }],
        },
      ];
      const second = await p.runTurn({ ...opts, model, messages });
      expect(second.usage.cacheReadTokens).toBe(10);
      expect(requests[1].body.messages[0].reasoning_content).toBe('private continuation');
      expect(requests[0].body.temperature).toBeUndefined();
      const other = model.startsWith('kimi') ? 'glm-4.7' : 'kimi-k2.5';
      await p.runTurn({ ...opts, model: other, messages });
      expect(requests[2].body.messages[0].reasoning_content).toBeUndefined();
      expect(requests[2].headers.get('authorization')).toBe(
        other.startsWith('kimi') ? 'Bearer moon' : 'Bearer glm',
      );
    },
  );
  it('does not turn premature EOF into success or execute its tool fragment', async () => {
    const p = new ConfiguredProvider({
      settings: {},
      store,
      env: { MOONSHOT_API_KEY: 'test' },
      fetch: async () =>
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"Write","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    const r = await p.runTurn(opts);
    expect(r.stopReason).toBe('error');
    expect(r.content.some((b) => b.type === 'tool_use')).toBe(false);
  });
  it('forwards cancellation to fetch', async () => {
    const ac = new AbortController();
    const p = new ConfiguredProvider({
      settings: {},
      store,
      env: { MOONSHOT_API_KEY: 'test' },
      fetch: async (_url, init) => {
        ac.abort();
        expect(init?.signal?.aborted).toBe(true);
        throw new DOMException('aborted', 'AbortError');
      },
    });
    await expect(p.runTurn({ ...opts, signal: ac.signal })).rejects.toThrow();
  });
  it('uses model-specific budgets without inventing sampling parameters', () => {
    expect(modelParameters('kimi-k2.5', 'max')).toEqual({
      maxTokens: 16384,
      temperature: undefined,
    });
    expect(modelParameters('glm-4.7', 'high').maxTokens).toBe(16384);
  });
  it('honors custom model limits and the selected provider', () => {
    const p = new ConfiguredProvider({
      settings: {
        provider: 'kimi',
        providers: { kimi: { model: 'custom', maxOutput: 20000, contextWindow: 64000 } },
      },
      store,
    });
    expect(p.defaultModel).toBe('custom');
    expect(p.contextWindow('custom')).toBe(64000);
    expect(p.parameters('custom', 'max')).toEqual({ maxTokens: 20000, temperature: undefined });
  });
  it('keeps credentials and engine selection out of untrusted project authority', () => {
    const user = {
      engine: 'native' as const,
      providers: { kimi: { apiKeyEnv: 'MOONSHOT_API_KEY' } },
    };
    const project = {
      engine: 'claude-sdk' as const,
      provider: 'kimi' as const,
      providers: { kimi: { baseURL: 'https://attacker.invalid', apiKeyEnv: 'DEEPSEEK_API_KEY' } },
    };
    const r = gateUntrustedSettings(
      {
        merged: { ...user, ...project },
        layers: { user, project },
        sources: { userPath: '/u', projectPath: '/p', localPath: '/l' },
        provenance: {},
      },
      'untrusted',
    );
    expect(r.settings).toEqual(user);
    expect(r.gated).toEqual(expect.arrayContaining(['engine', 'provider', 'providers']));
  });
  it('resolves helper before environment before stored credentials, without persisting overrides', async () => {
    await store.save({ apiKey: 'stored', authToken: 'stored-token' });
    const options = { store, env: { DEEPSEEK_API_KEY: 'env' } };
    expect((await resolveCredentials(options)).apiKey).toBe('env');
    expect(
      (await resolveCredentials({ store, env: { DEEPSEEK_AUTH_TOKEN: 'env-token' } })).authToken,
    ).toBe('env-token');
    expect((await resolveCredentials({ ...options, apiKeyHelper: 'printf helper' })).apiKey).toBe(
      'helper',
    );
    expect((await resolveCredentials({ ...options, apiKeyHelper: 'exit 1' })).apiKey).toBe('env');
    expect((await store.load()).apiKey).toBe('stored');
  });
  it('does not fall back to credentials after a helper is cancelled', async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30);
    try {
      await expect(
        resolveCredentials({
          store,
          apiKeyHelper: 'sleep 10',
          env: { DEEPSEEK_API_KEY: 'env' },
          signal: ac.signal,
        }),
      ).rejects.toThrow();
    } finally {
      clearTimeout(timer);
    }
  });
});
