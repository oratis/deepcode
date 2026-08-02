import { describe, expect, it } from 'vitest';
import type { Provider, ProviderResult, ProviderRunOpts } from '../providers/types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolHandler } from '../types.js';
import { RuntimeHost } from './host.js';

class ScriptedProvider implements Provider {
  readonly name = 'scripted';
  constructor(private readonly results: ProviderResult[]) {}
  async runTurn(_opts: ProviderRunOpts): Promise<ProviderResult> {
    const result = this.results.shift();
    if (!result) throw new Error('no scripted result');
    return result;
  }
}

const usage = { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0 };

function writeThenDone(): ProviderResult[] {
  return [
    {
      content: [
        {
          type: 'tool_use',
          id: 'write-1',
          name: 'Write',
          input: { file_path: 'x', content: 'x' },
        },
      ],
      stopReason: 'tool_use',
      usage,
    },
    {
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'end_turn',
      usage,
    },
  ];
}

describe('RuntimeHost', () => {
  it('fails closed when the host omits policy and approval', async () => {
    let executions = 0;
    const write: ToolHandler = {
      name: 'Write',
      definition: { name: 'Write', description: 'test', inputSchema: {} },
      execute: async () => {
        executions++;
        return { content: 'wrote' };
      },
    };
    const host = new RuntimeHost({
      provider: new ScriptedProvider(writeThenDone()),
      tools: new ToolRegistry([write]),
      cwd: '/tmp',
    });

    const result = await host.run({
      systemPrompt: '',
      userMessage: 'write',
      model: 'deepseek-chat',
      systemReminders: false,
    });

    expect(executions).toBe(0);
    expect(result.history.flatMap((message) => message.content)).toContainEqual(
      expect.objectContaining({ type: 'tool_result', is_error: true }),
    );
  });

  it('keeps host policy while accepting an explicit turn mode override', async () => {
    let executions = 0;
    const write: ToolHandler = {
      name: 'Write',
      definition: { name: 'Write', description: 'test', inputSchema: {} },
      execute: async () => {
        executions++;
        return { content: 'wrote' };
      },
    };
    const host = new RuntimeHost({
      provider: new ScriptedProvider(writeThenDone()),
      tools: new ToolRegistry([write]),
      cwd: '/tmp',
      mode: 'default',
    });

    await host.run({
      systemPrompt: '',
      userMessage: 'write',
      model: 'deepseek-chat',
      systemReminders: false,
      modeOverride: 'bypassPermissions',
    });

    expect(executions).toBe(1);
    expect(host.mode).toBe('default');
  });

  it('requires a cwd at either boundary', () => {
    const host = new RuntimeHost({
      provider: new ScriptedProvider([]),
      tools: new ToolRegistry(),
    });
    expect(() => host.run({ systemPrompt: '', userMessage: 'x', model: 'deepseek-chat' })).toThrow(
      /requires cwd/,
    );
  });
});
