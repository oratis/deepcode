import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgent } from './agent.js';
import { SessionManager } from './sessions/index.js';
import { ToolRegistry } from './tools/registry.js';
import type { AgentEvent, ContentBlock, StoredMessage, ToolUseBlock } from './types.js';
import type { Provider, ProviderResult, ProviderRunOpts } from './providers/types.js';

/**
 * MockProvider — pulls scripted responses from a queue, allowing fully deterministic
 * agent loop tests with no real API calls.
 */
class MockProvider implements Provider {
  readonly name = 'mock';
  readonly received: ProviderRunOpts[] = [];
  constructor(private readonly responses: ProviderResult[]) {}
  async runTurn(opts: ProviderRunOpts): Promise<ProviderResult> {
    this.received.push(opts);
    const next = this.responses.shift();
    if (!next) throw new Error('MockProvider: no scripted response left');
    return next;
  }
}

function plainText(text: string): ContentBlock[] {
  return [{ type: 'text', text }];
}
function withToolCall(text: string, call: ToolUseBlock): ContentBlock[] {
  return [{ type: 'text', text }, call];
}
function endTurn(text: string): ProviderResult {
  return {
    content: plainText(text),
    stopReason: 'end_turn',
    usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0 },
  };
}
function toolUse(text: string, call: ToolUseBlock): ProviderResult {
  return {
    content: withToolCall(text, call),
    stopReason: 'tool_use',
    usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0 },
  };
}

describe('runAgent', () => {
  let cwd: string;
  let sessionsRoot: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dc-agent-cwd-'));
    sessionsRoot = await mkdtemp(join(tmpdir(), 'dc-agent-sessions-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(sessionsRoot, { recursive: true, force: true });
  });

  it('terminates on end_turn (no tool calls)', async () => {
    const provider = new MockProvider([endTurn('hello!')]);
    const tools = new ToolRegistry();
    const events: AgentEvent[] = [];
    const result = await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'hi',
      model: 'deepseek-chat',
      cwd,
      onEvent: (e) => events.push(e),
    });
    expect(result.stopReason).toBe('end_turn');
    expect(result.turnsUsed).toBe(1);
    expect(result.history).toHaveLength(2); // user + assistant
    expect(events.some((e) => e.type === 'turn_complete')).toBe(true);
  });

  it('executes a tool call then continues', async () => {
    // Create a file the agent will read
    await fs.writeFile(join(cwd, 'a.txt'), 'file content!');

    const provider = new MockProvider([
      toolUse('reading', {
        type: 'tool_use',
        id: 'call_1',
        name: 'Read',
        input: { file_path: 'a.txt' },
      }),
      endTurn('done reading'),
    ]);
    const tools = new ToolRegistry();

    const events: AgentEvent[] = [];
    const result = await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'please read a.txt',
      model: 'deepseek-chat',
      cwd,
      onEvent: (e) => events.push(e),
    });

    expect(result.stopReason).toBe('end_turn');
    expect(result.turnsUsed).toBe(2);
    // user + assistant(toolUse) + user(toolResult) + assistant(end)
    expect(result.history).toHaveLength(4);
    const toolEvents = events.filter((e) => e.type === 'tool_use');
    expect(toolEvents).toHaveLength(1);
    const resultEvents = events.filter((e) => e.type === 'tool_result');
    expect(resultEvents).toHaveLength(1);
  });

  it('handles unknown tool gracefully', async () => {
    const provider = new MockProvider([
      toolUse('using nope', {
        type: 'tool_use',
        id: 'c1',
        name: 'NonExistentTool',
        input: {},
      }),
      endTurn('done'),
    ]);
    const tools = new ToolRegistry();
    const result = await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'go',
      model: 'deepseek-chat',
      cwd,
    });
    expect(result.stopReason).toBe('end_turn');
    // Tool result block should report the error
    const lastBeforeFinal = result.history[result.history.length - 2];
    expect(lastBeforeFinal?.role).toBe('user');
    const block = lastBeforeFinal?.content[0];
    if (block?.type === 'tool_result') {
      expect(block.is_error).toBe(true);
      expect(block.content).toMatch(/tool not found/i);
    }
  });

  it('respects maxTurns cap', async () => {
    // Loop forever (provider keeps returning tool_use)
    const provider = new MockProvider([
      toolUse('t1', { type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'x' } }),
      toolUse('t2', { type: 'tool_use', id: 'c2', name: 'Read', input: { file_path: 'x' } }),
      toolUse('t3', { type: 'tool_use', id: 'c3', name: 'Read', input: { file_path: 'x' } }),
    ]);
    const tools = new ToolRegistry();
    const result = await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'loop',
      model: 'deepseek-chat',
      cwd,
      maxTurns: 2,
    });
    expect(result.stopReason).toBe('max_turns');
    expect(result.turnsUsed).toBe(2);
  });

  it('respects abort signal', async () => {
    const ac = new AbortController();
    ac.abort();
    const provider = new MockProvider([endTurn('nope')]);
    const tools = new ToolRegistry();
    const result = await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'go',
      model: 'deepseek-chat',
      cwd,
      signal: ac.signal,
    });
    expect(result.stopReason).toBe('aborted');
    expect(result.turnsUsed).toBe(0);
  });

  it('persists messages and captures snapshots when session is provided', async () => {
    await fs.writeFile(join(cwd, 'edit-me.txt'), 'before');
    const sessionMgr = new SessionManager({ root: sessionsRoot });
    const session = await sessionMgr.create(cwd);

    const provider = new MockProvider([
      toolUse('editing', {
        type: 'tool_use',
        id: 'e1',
        name: 'Edit',
        input: {
          file_path: 'edit-me.txt',
          old_string: 'before',
          new_string: 'after',
        },
      }),
      endTurn('done'),
    ]);
    const tools = new ToolRegistry();
    await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'flip it',
      model: 'deepseek-chat',
      cwd,
      session: { manager: sessionMgr, id: session.id },
    });

    const loaded = await sessionMgr.load(session.id);
    expect(loaded?.messages.length).toBe(4);
    const snaps = await sessionMgr.snapshots(session.id);
    // pre-Edit + post-Edit
    expect(snaps).toHaveLength(2);
    expect(snaps[0]?.reason).toBe('pre-Edit');
    expect(snaps[1]?.reason).toBe('post-Edit');
    expect(await fs.readFile(join(cwd, 'edit-me.txt'), 'utf8')).toBe('after');
  });

  it('feeds tool_result back to next provider call', async () => {
    await fs.writeFile(join(cwd, 'x.txt'), 'X-content');
    const provider = new MockProvider([
      toolUse('reading', {
        type: 'tool_use',
        id: 'r1',
        name: 'Read',
        input: { file_path: 'x.txt' },
      }),
      endTurn('done'),
    ]);
    const tools = new ToolRegistry();
    await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'q',
      model: 'deepseek-chat',
      cwd,
    });

    // Provider got two calls; the second should have the tool_result in its messages
    expect(provider.received).toHaveLength(2);
    const secondCall = provider.received[1]!;
    const lastMsg = secondCall.messages[secondCall.messages.length - 1] as StoredMessage;
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content[0]?.type).toBe('tool_result');
    if (lastMsg.content[0]?.type === 'tool_result') {
      expect(lastMsg.content[0].tool_use_id).toBe('r1');
      expect(lastMsg.content[0].content).toContain('X-content');
    }
  });

  it('prepends a <system-reminder> block to the user message by default', async () => {
    const provider = new MockProvider([endTurn('hi')]);
    const tools = new ToolRegistry();
    await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'do the thing',
      model: 'deepseek-chat',
      cwd,
    });
    const sentMessages = provider.received[0]!.messages;
    const firstUser = sentMessages[0] as StoredMessage;
    const text = firstUser.content.find((c) => c.type === 'text');
    expect(text?.type).toBe('text');
    if (text?.type === 'text') {
      expect(text.text).toMatch(/<system-reminder>/);
      expect(text.text).toMatch(/Today's date/);
      expect(text.text).toMatch(/Current working directory/);
      expect(text.text).toMatch(/do the thing$/);
    }
  });

  it('honors systemReminders: false to skip injection entirely', async () => {
    const provider = new MockProvider([endTurn('hi')]);
    const tools = new ToolRegistry();
    await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'no reminder please',
      model: 'deepseek-chat',
      cwd,
      systemReminders: false,
    });
    const firstUser = provider.received[0]!.messages[0] as StoredMessage;
    const text = firstUser.content[0];
    if (text?.type === 'text') {
      expect(text.text).toBe('no reminder please');
      expect(text.text).not.toMatch(/<system-reminder>/);
    } else {
      expect.fail('expected text block');
    }
  });
});
