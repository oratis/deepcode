import {
  RuntimeHost,
  ToolRegistry,
  type Provider,
  type ProviderResult,
  type ProviderRunOpts,
} from '@deepcode/core';
import type { ThreadSnapshot, TurnSnapshot } from '@deepcode/protocol';
import { describe, expect, it } from 'vitest';

import { RuntimeHostExecutor, historyFromThread } from './runtime-executor.js';

const priorAssistant = {
  role: 'assistant' as const,
  content: [{ type: 'text' as const, text: 'prior answer' }],
};

const thread: ThreadSnapshot = {
  id: 'thread-1',
  cwd: '/workspace',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:01.000Z',
  turns: [
    {
      id: 'turn-prior',
      threadId: 'thread-1',
      status: 'completed',
      startedAt: '2026-08-01T00:00:00.000Z',
      completedAt: '2026-08-01T00:00:01.000Z',
      items: [
        {
          id: 'item-user',
          type: 'user_message',
          payload: { text: 'prior question' },
          completedAt: '2026-08-01T00:00:00.000Z',
        },
        {
          id: 'item-assistant',
          type: 'assistant_message',
          payload: { message: priorAssistant },
          completedAt: '2026-08-01T00:00:01.000Z',
        },
      ],
    },
  ],
};

class StreamingProvider implements Provider {
  readonly name = 'streaming-test';
  seenMessages: ProviderRunOpts['messages'] = [];

  async runTurn(options: ProviderRunOpts): Promise<ProviderResult> {
    this.seenMessages = options.messages;
    options.handlers?.onTextDelta?.('new ');
    options.handlers?.onTextDelta?.('answer');
    return {
      content: [{ type: 'text', text: 'new answer' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 2, reasoningTokens: 0, cacheReadTokens: 0 },
    };
  }
}

describe('RuntimeHostExecutor', () => {
  it('reconstructs history and returns only messages created by the new turn', async () => {
    const provider = new StreamingProvider();
    const host = new RuntimeHost({
      provider,
      tools: new ToolRegistry(),
      cwd: '/workspace',
    });
    const executor = new RuntimeHostExecutor({ createHost: () => host });
    const turn: TurnSnapshot = {
      id: 'turn-current',
      threadId: thread.id,
      status: 'in_progress',
      startedAt: '2026-08-01T00:00:02.000Z',
      items: [],
    };
    const deltas: string[] = [];

    const result = await executor.execute({
      thread,
      turn,
      input: { text: 'current question' },
      signal: new AbortController().signal,
      publishDelta: (_itemId, delta) => deltas.push(delta),
    });

    expect(provider.seenMessages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'prior question' }] },
      priorAssistant,
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: 'current question' }],
      }),
    ]);
    expect(deltas).toEqual(['new ', 'answer']);
    expect(result).toEqual({
      status: 'completed',
      items: [
        {
          type: 'assistant_message',
          payload: {
            message: expect.objectContaining({
              role: 'assistant',
              content: [{ type: 'text', text: 'new answer' }],
            }),
          },
        },
      ],
    });
  });

  it('ignores non-message protocol items when rebuilding provider history', () => {
    const withError: ThreadSnapshot = {
      ...thread,
      turns: [
        {
          ...thread.turns[0]!,
          items: [
            ...thread.turns[0]!.items,
            {
              id: 'item-error',
              type: 'error',
              payload: { message: 'transport failed' },
              completedAt: '2026-08-01T00:00:01.000Z',
            },
          ],
        },
      ],
    };

    expect(historyFromThread(withError)).toHaveLength(2);
  });
});
