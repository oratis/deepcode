// Live integration tests against real api.deepseek.com.
// Skipped automatically unless DEEPSEEK_API_KEY (or stored credentials) is available.
//
// These were used in fact to validate M1's mock-based unit tests against real
// wire behaviour 2026-05-28 — they confirmed:
//   · text streaming chunk shape matches our mock
//   · tool_calls streaming with incremental arguments accumulation matches our mock
//   · reasoning_content streaming on deepseek-reasoner is captured into thinking blocks
//   · /v1/models returns deepseek-v4-flash + deepseek-v4-pro; deepseek-chat /
//     deepseek-reasoner are stable aliases (still accepted at the API layer)
//
// To run: DEEPSEEK_API_KEY=sk-... pnpm --filter @deepcode/core test live
// Or: place a key in ~/.deepcode/credentials.json (the CLI does this on onboard).

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeepSeekProvider } from './deepseek.js';

async function resolveTestKey(): Promise<string | null> {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const raw = await fs.readFile(join(homedir(), '.deepcode', 'credentials.json'), 'utf8');
    const parsed = JSON.parse(raw) as { apiKey?: string };
    return parsed.apiKey ?? null;
  } catch {
    return null;
  }
}

// Live tests cost real API tokens. They only run when DEEPCODE_LIVE_TESTS=1 is set,
// even if credentials are available locally — protects against accidental burns
// on every `pnpm test`.
const enabled = process.env.DEEPCODE_LIVE_TESTS === '1';
const apiKey = enabled ? await resolveTestKey() : null;
const live = enabled && apiKey ? describe : describe.skip;

live('DeepSeekProvider — live API', () => {
  it('streams text deltas from deepseek-chat', async () => {
    const p = new DeepSeekProvider({ apiKey: apiKey! });
    const out: string[] = [];
    const result = await p.runTurn({
      model: 'deepseek-chat',
      systemPrompt: 'Reply only with: ok',
      tools: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Ready?' }] }],
      maxTokens: 10,
      handlers: { onTextDelta: (t) => out.push(t) },
    });
    expect(out.join('').length).toBeGreaterThan(0);
    expect(result.stopReason).toBe('end_turn');
    expect(result.content.find((b) => b.type === 'text')).toBeDefined();
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  }, 30_000);

  it('emits tool_use block when the model invokes a tool', async () => {
    const p = new DeepSeekProvider({ apiKey: apiKey! });
    const result = await p.runTurn({
      model: 'deepseek-chat',
      systemPrompt: 'You must use the Echo tool when asked.',
      tools: [
        {
          name: 'Echo',
          description: 'Echo back the input text.',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Call the Echo tool with text "hello".' }],
        },
      ],
      maxTokens: 100,
    });
    const toolUse = result.content.find((b) => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    if (toolUse?.type === 'tool_use') {
      expect(toolUse.name).toBe('Echo');
      expect(toolUse.input).toMatchObject({ text: expect.any(String) });
      expect(toolUse.id).toMatch(/call_/);
    }
    expect(result.stopReason).toBe('tool_use');
  }, 30_000);

  it('captures reasoning_content into thinking blocks for deepseek-reasoner', async () => {
    const p = new DeepSeekProvider({ apiKey: apiKey! });
    let thinkingChunks = 0;
    const result = await p.runTurn({
      model: 'deepseek-reasoner',
      systemPrompt: 'Solve briefly. Show one line of reasoning.',
      tools: [],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'What is 17 * 23? Just the number.' }],
        },
      ],
      maxTokens: 400,
      handlers: {
        onThinkingDelta: () => {
          thinkingChunks++;
        },
      },
    });
    // reasoner should stream reasoning_content and produce a thinking block
    expect(thinkingChunks).toBeGreaterThan(0);
    expect(result.content.find((b) => b.type === 'thinking')).toBeDefined();
    expect(result.usage.reasoningTokens).toBeGreaterThan(0);
  }, 60_000);
});
