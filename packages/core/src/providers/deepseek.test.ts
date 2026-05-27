import { describe, expect, it } from 'vitest';
import { DeepSeekProvider, DEEPSEEK_MODELS, EFFORT_PARAMS, __internals } from './deepseek.js';

// Helper: build a mock fetch that returns a stream of OpenAI-style SSE chunks
function mockFetch(chunks: object[]): typeof globalThis.fetch {
  return (async () => {
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as unknown as typeof globalThis.fetch;
}

describe('DeepSeekProvider', () => {
  it('constructs with apiKey and default baseURL', async () => {
    const p = new DeepSeekProvider({ apiKey: 'sk-test' });
    expect(p.name).toBe('deepseek');
    expect((await p.ping()).ok).toBe(true);
  });

  it('rejects when no credentials provided', () => {
    expect(() => new DeepSeekProvider({ apiKey: '' })).toThrow(/apiKey or authToken/);
  });

  it('accepts authToken (Bearer flow)', async () => {
    const p = new DeepSeekProvider({ apiKey: '', authToken: 'token-x' });
    expect((await p.ping()).ok).toBe(true);
  });

  it('DEEPSEEK_MODELS enforces 8192 max-output (API hard limit)', () => {
    expect(DEEPSEEK_MODELS['deepseek-chat'].maxOutput).toBe(8192);
    expect(DEEPSEEK_MODELS['deepseek-reasoner'].maxOutput).toBe(8192);
  });

  it('EFFORT_PARAMS stays within DeepSeek hard limit', () => {
    for (const [, params] of Object.entries(EFFORT_PARAMS)) {
      expect(params.maxTokens).toBeLessThanOrEqual(8192);
    }
  });

  it('streams text deltas via runTurn', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      },
    ];
    const p = new DeepSeekProvider({ apiKey: 'sk-test', fetch: mockFetch(chunks) });
    const out: string[] = [];
    const result = await p.runTurn({
      model: 'deepseek-chat',
      systemPrompt: 'system',
      tools: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      handlers: { onTextDelta: (t) => out.push(t) },
    });
    expect(out.join('')).toBe('Hello');
    expect(result.stopReason).toBe('end_turn');
    expect(result.content).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(result.usage.inputTokens).toBe(5);
    expect(result.usage.outputTokens).toBe(2);
  });

  it('parses reasoning_content as thinking blocks', async () => {
    const chunks = [
      { choices: [{ delta: { reasoning_content: 'thinking... ' } }] },
      { choices: [{ delta: { content: 'answer' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 1,
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      },
    ];
    const p = new DeepSeekProvider({ apiKey: 'sk-test', fetch: mockFetch(chunks) });
    const result = await p.runTurn({
      model: 'deepseek-reasoner',
      systemPrompt: '',
      tools: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
    });
    expect(result.content[0]?.type).toBe('thinking');
    if (result.content[0]?.type === 'thinking') {
      expect(result.content[0].text).toBe('thinking... ');
    }
    expect(result.content[1]?.type).toBe('text');
    expect(result.usage.reasoningTokens).toBe(2);
  });

  it('assembles tool_use blocks from streaming tool_calls', async () => {
    const chunks = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"file' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '_path":"src/a.ts"}' } }],
            },
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 8, completion_tokens: 4 },
      },
    ];
    const p = new DeepSeekProvider({ apiKey: 'sk-test', fetch: mockFetch(chunks) });
    const result = await p.runTurn({
      model: 'deepseek-chat',
      systemPrompt: '',
      tools: [
        {
          name: 'Read',
          description: '',
          inputSchema: { type: 'object', properties: { file_path: { type: 'string' } } },
        },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'open it' }] }],
    });
    expect(result.stopReason).toBe('tool_use');
    expect(result.content[0]?.type).toBe('tool_use');
    if (result.content[0]?.type === 'tool_use') {
      expect(result.content[0].name).toBe('Read');
      expect(result.content[0].input).toEqual({ file_path: 'src/a.ts' });
    }
  });
});

describe('DeepSeekProvider message conversion', () => {
  const { anthropicShapeToOpenAI } = __internals;

  it('inserts system prompt as system role', () => {
    const out = anthropicShapeToOpenAI('SYS', []);
    expect(out[0]).toEqual({ role: 'system', content: 'SYS' });
  });

  it('converts user text', () => {
    const out = anthropicShapeToOpenAI('', [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('converts assistant text + tool_use to tool_calls', () => {
    const out = anthropicShapeToOpenAI('', [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'sure, reading...' },
          { type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
    ]);
    expect(out[0]).toMatchObject({
      role: 'assistant',
      content: 'sure, reading...',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"a.ts"}' },
        },
      ],
    });
  });

  it('converts tool_result block to role:"tool" message', () => {
    const out = anthropicShapeToOpenAI('', [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'file contents here' }],
      },
    ]);
    expect(out).toEqual([{ role: 'tool', tool_call_id: 'c1', content: 'file contents here' }]);
  });

  it('skips thinking blocks (they are streaming-only)', () => {
    const out = anthropicShapeToOpenAI('', [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'should be hidden' },
          { type: 'text', text: 'visible' },
        ],
      },
    ]);
    expect(out[0]?.content).toBe('visible');
    expect(JSON.stringify(out)).not.toContain('should be hidden');
  });
});
