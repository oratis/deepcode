import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RuntimeHost,
  SessionManager,
  ToolRegistry,
  type Provider,
  type ProviderResult,
  type ProviderRunOpts,
} from '@deepcode/core';
import type { ThreadSnapshot, TurnSnapshot } from '@deepcode/protocol';
import { describe, expect, it } from 'vitest';

import { RuntimeHostExecutor, historyFromThread } from './runtime-executor.js';

function protocolCallbacks() {
  return {
    publishToolStarted: () => undefined,
    publishToolCompleted: () => undefined,
    publishUsage: () => undefined,
    requestApproval: async () => 'deny' as const,
    requestUserInput: async () => '',
  };
}

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

class ToolProvider implements Provider {
  readonly name = 'tool-test';
  calls = 0;

  async runTurn(options: ProviderRunOpts): Promise<ProviderResult> {
    this.calls++;
    if (this.calls === 1) {
      return {
        content: [{ type: 'tool_use', id: 'tool-1', name: 'WriteTest', input: { value: 'ok' } }],
        stopReason: 'tool_use',
        usage: { inputTokens: 3, outputTokens: 4, reasoningTokens: 1, cacheReadTokens: 2 },
      };
    }
    options.handlers?.onTextDelta?.('done');
    return {
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 5, outputTokens: 6, reasoningTokens: 0, cacheReadTokens: 0 },
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
      ...protocolCallbacks(),
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

  it('projects tool, usage, and approval activity onto protocol callbacks', async () => {
    const provider = new ToolProvider();
    const tools = new ToolRegistry();
    tools.register({
      name: 'WriteTest',
      definition: { name: 'WriteTest', description: 'test', inputSchema: { type: 'object' } },
      execute: async () => ({ content: 'wrote test value' }),
    });
    const host = new RuntimeHost({ provider, tools, cwd: '/workspace', mode: 'default' });
    const executor = new RuntimeHostExecutor({ createHost: () => host });
    const turn: TurnSnapshot = {
      id: 'turn-tool',
      threadId: thread.id,
      status: 'in_progress',
      startedAt: '2026-08-01T00:00:02.000Z',
      items: [],
    };
    const started: string[] = [];
    const completed: string[] = [];
    const usage: number[] = [];
    const approvals: string[] = [];

    const result = await executor.execute({
      thread,
      turn,
      input: { text: 'write it', effort: 'low' },
      signal: new AbortController().signal,
      publishDelta: () => undefined,
      publishToolStarted: (itemId) => started.push(itemId),
      publishToolCompleted: (itemId) => completed.push(itemId),
      publishUsage: (value) => usage.push(value.inputTokens),
      requestApproval: async (toolName) => {
        approvals.push(toolName);
        return 'allow';
      },
      requestUserInput: async () => '',
    });

    expect(started).toEqual(['tool-1']);
    expect(completed).toEqual(['tool-1']);
    expect(usage).toEqual([3, 5]);
    expect(approvals).toEqual(['WriteTest']);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'approval' }),
        expect.objectContaining({ type: 'assistant_message' }),
        expect.objectContaining({ type: 'tool_result' }),
      ]),
    );
  });

  it('keeps session snapshots without becoming a second message writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepcode-executor-session-'));
    try {
      const workspace = join(root, 'workspace');
      const filePath = join(workspace, 'file.txt');
      await mkdir(workspace);
      await writeFile(filePath, 'before');
      const provider = new ToolProvider();
      const tools = new ToolRegistry([]);
      // The core snapshot pipeline recognizes canonical Write/Edit names.
      provider.runTurn = async (options) => {
        provider.calls++;
        if (provider.calls === 1) {
          return {
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Write', input: { file_path: filePath } },
            ],
            stopReason: 'tool_use',
            usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0 },
          };
        }
        options.handlers?.onTextDelta?.('done');
        return {
          content: [{ type: 'text', text: 'done' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0 },
        };
      };
      tools.register({
        name: 'Write',
        definition: { name: 'Write', description: 'write', inputSchema: { type: 'object' } },
        execute: async () => {
          await writeFile(filePath, 'after');
          return { content: 'written' };
        },
      });
      const sessions = new SessionManager({ root: join(root, 'sessions') });
      const host = new RuntimeHost({ provider, tools, cwd: workspace, mode: 'default' });
      const executor = new RuntimeHostExecutor({
        createHost: () => host,
        sessionManager: sessions,
      });
      await executor.execute({
        thread: { ...thread, id: 'thread-snapshots', cwd: workspace, turns: [] },
        turn: {
          id: 'turn-snapshots',
          threadId: 'thread-snapshots',
          status: 'in_progress',
          startedAt: '2026-08-01T00:00:00.000Z',
          items: [],
        },
        input: { text: 'write' },
        signal: new AbortController().signal,
        publishDelta: () => undefined,
        ...protocolCallbacks(),
        requestApproval: async () => 'allow',
      });

      await expect(sessions.load('thread-snapshots')).resolves.toBeNull();
      await expect(sessions.snapshots('thread-snapshots')).resolves.toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
