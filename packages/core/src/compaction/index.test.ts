import { describe, expect, it } from 'vitest';
import { compact, shouldCompact } from './index.js';
import type { StoredMessage } from '../types.js';
import type { Provider, ProviderResult, ProviderRunOpts } from '../providers/types.js';

class MockProvider implements Provider {
  readonly name = 'mock';
  received: ProviderRunOpts | null = null;
  constructor(private summary: string) {}
  async runTurn(opts: ProviderRunOpts): Promise<ProviderResult> {
    this.received = opts;
    return {
      content: [{ type: 'text', text: this.summary }],
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 0, cacheReadTokens: 0 },
    };
  }
}

function msg(role: 'user' | 'assistant', text: string): StoredMessage {
  return { role, content: [{ type: 'text', text }] };
}

describe('compact', () => {
  it('returns history unchanged when below threshold', async () => {
    const history = [msg('user', 'a'), msg('assistant', 'b')];
    const provider = new MockProvider('summary');
    const r = await compact(history, { provider });
    expect(r.history).toEqual(history);
    expect(r.messagesRemoved).toBe(0);
    expect(provider.received).toBeNull(); // no LLM call
  });

  it('compacts middle messages when history is long', async () => {
    const history: StoredMessage[] = [];
    for (let i = 0; i < 20; i++) {
      history.push(msg(i % 2 === 0 ? 'user' : 'assistant', `message ${i}`));
    }
    const provider = new MockProvider('• read file X\n• fixed bug Y');
    const r = await compact(history, { provider, keepFirstPairs: 1, keepLastMessages: 4 });
    expect(r.history.length).toBe(1 + 1 + 4); // first + summary + last 4
    expect(r.messagesRemoved).toBe(20 - 1 - 4);
    // Summary message is in the middle
    const summary = r.history[1];
    expect(summary?.role).toBe('assistant');
    const text = summary?.content[0];
    if (text?.type === 'text') {
      expect(text.text).toContain('Conversation compacted');
      expect(text.text).toContain('read file X');
    }
  });

  it('preserves first N pairs as anchor', async () => {
    const history: StoredMessage[] = [
      msg('user', 'TASK_DEFINITION'),
      msg('assistant', 'work in progress'),
      ...Array.from({ length: 10 }, (_, i) => msg('user', `mid-${i}`)),
      ...Array.from({ length: 5 }, (_, i) => msg('assistant', `tail-${i}`)),
    ];
    const provider = new MockProvider('mid summary');
    const r = await compact(history, { provider, keepFirstPairs: 2, keepLastMessages: 5 });
    // First two messages should match the original
    const first = r.history[0];
    if (first?.content[0]?.type === 'text') {
      expect(first.content[0].text).toBe('TASK_DEFINITION');
    }
    const tailMatch = r.history[r.history.length - 1];
    if (tailMatch?.content[0]?.type === 'text') {
      expect(tailMatch.content[0].text).toBe('tail-4');
    }
  });

  it('uses the summarizerModel option when provided', async () => {
    const history = Array.from({ length: 20 }, (_, i) => msg('user', `m${i}`));
    const provider = new MockProvider('s');
    await compact(history, { provider, summarizerModel: 'custom-model' });
    expect(provider.received?.model).toBe('custom-model');
  });

  it('reports usage from the summarizer call', async () => {
    const history = Array.from({ length: 20 }, (_, i) => msg('user', `m${i}`));
    const provider = new MockProvider('s');
    const r = await compact(history, { provider });
    expect(r.usage.inputTokens).toBe(100);
    expect(r.usage.outputTokens).toBe(50);
  });

  it('includes tool_use / tool_result in summary prompt', async () => {
    const history: StoredMessage[] = [
      msg('user', 'go'),
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: '/x' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'file content here' }],
      },
      ...Array.from({ length: 15 }, (_, i) => msg('user', `m${i}`)),
      msg('assistant', 'done'),
    ];
    const provider = new MockProvider('s');
    await compact(history, { provider, keepFirstPairs: 1, keepLastMessages: 2 });
    const prompt = provider.received?.messages[0]?.content[0];
    if (prompt?.type === 'text') {
      expect(prompt.text).toContain('[tool: Read');
      expect(prompt.text).toContain('[tool result:');
    }
  });
});

describe('shouldCompact', () => {
  it('returns false below 80% threshold', () => {
    expect(
      shouldCompact({ inputTokens: 50_000, outputTokens: 10_000, contextWindow: 128_000 }),
    ).toBe(false);
  });
  it('returns true at/above 80% threshold', () => {
    expect(
      shouldCompact({ inputTokens: 100_000, outputTokens: 4_000, contextWindow: 128_000 }),
    ).toBe(true);
  });
  it('respects custom threshold', () => {
    expect(
      shouldCompact({
        inputTokens: 50_000,
        outputTokens: 14_000,
        contextWindow: 128_000,
        threshold: 0.5,
      }),
    ).toBe(true);
  });
});
