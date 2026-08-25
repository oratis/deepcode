import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent as runAgentCore, type RunAgentOptions } from './agent.js';
import { parseFileContract } from './config/file-contract.js';
import type { LedgerKind, LedgerSink, NewLedgerRecord } from './ledger/index.js';
import { HookDispatcher } from './hooks/index.js';
import { SessionManager } from './sessions/index.js';
import { ToolRegistry } from './tools/registry.js';
import type {
  AgentEvent,
  ContentBlock,
  StoredMessage,
  ToolHandler,
  ToolUseBlock,
} from './types.js';
import type { Provider, ProviderResult, ProviderRunOpts } from './providers/types.js';

type TestRunAgentOptions = Omit<RunAgentOptions, 'mode'> & { mode?: RunAgentOptions['mode'] };

/** Most loop tests predate policy dispatch and focus on orchestration behavior. */
function runAgent(opts: TestRunAgentOptions) {
  return runAgentCore({ mode: 'bypassPermissions', ...opts });
}

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
    const steps = events.filter((e) => e.type === 'model_step_complete');
    expect(steps).toHaveLength(2);
    expect(steps.map((event) => event.step)).toEqual([1, 2]);
    const completed = events.filter((e) => e.type === 'turn_complete');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ stopReason: 'end_turn' });
  });

  it('enforces a host-owned per-turn tool ceiling', async () => {
    const provider = new MockProvider([
      toolUse('trying a forbidden write', {
        type: 'tool_use',
        id: 'call-forbidden',
        name: 'Write',
        input: { file_path: 'forbidden.txt', content: 'nope' },
      }),
      endTurn('stopped'),
    ]);
    const result = await runAgent({
      provider,
      tools: new ToolRegistry(),
      systemPrompt: '',
      userMessage: 'restricted turn',
      model: 'deepseek-chat',
      cwd,
      allowedTools: ['Read'],
    });

    expect(provider.received[0]?.tools.map((tool) => tool.name)).toEqual(['Read']);
    expect(JSON.stringify(result.history)).toContain('tool not allowed in this turn: Write');
    await expect(fs.access(join(cwd, 'forbidden.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
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

  it('classifies a provider AbortError as an aborted run', async () => {
    const ac = new AbortController();
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const provider: Provider = {
      name: 'abortable',
      runTurn: async () => {
        markEntered();
        await new Promise<void>((_resolve, reject) => {
          ac.signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
            { once: true },
          );
        });
        throw new Error('unreachable');
      },
    };
    const pending = runAgent({
      provider,
      tools: new ToolRegistry(),
      systemPrompt: '',
      userMessage: 'go',
      model: 'deepseek-chat',
      cwd,
      signal: ac.signal,
    });
    await entered;
    ac.abort();
    await expect(pending).resolves.toMatchObject({ stopReason: 'aborted', turnsUsed: 1 });
  });

  it('fails safe for a legacy caller that omits mode and permissions', async () => {
    const provider = new MockProvider([
      toolUse('writing', {
        type: 'tool_use',
        id: 'write-1',
        name: 'Write',
        input: { file_path: 'blocked.txt', content: 'must not exist' },
      }),
      endTurn('done'),
    ]);

    const result = await runAgentCore({
      provider,
      tools: new ToolRegistry(),
      systemPrompt: '',
      userMessage: 'write a file',
      model: 'deepseek-chat',
      cwd,
    } as RunAgentOptions);

    expect(result.stopReason).toBe('end_turn');
    await expect(fs.access(join(cwd, 'blocked.txt'))).rejects.toThrow();
    const toolResult = result.history
      .flatMap((message) => message.content)
      .find((block) => block.type === 'tool_result');
    expect(toolResult).toMatchObject({ is_error: true });
  });

  it('aborts while an approval prompt is pending', async () => {
    const ac = new AbortController();
    let approvalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      approvalStarted = resolve;
    });
    const provider = new MockProvider([
      toolUse('writing', {
        type: 'tool_use',
        id: 'write-pending',
        name: 'Write',
        input: { file_path: 'pending.txt', content: 'must not exist' },
      }),
    ]);

    const pending = runAgentCore({
      provider,
      tools: new ToolRegistry(),
      systemPrompt: '',
      userMessage: 'write a file',
      model: 'deepseek-chat',
      cwd,
      signal: ac.signal,
      mode: 'default',
      approval: async () => {
        approvalStarted();
        return new Promise<boolean>(() => {});
      },
    });
    await started;
    ac.abort();

    await expect(pending).resolves.toMatchObject({ stopReason: 'aborted', turnsUsed: 1 });
    await expect(fs.access(join(cwd, 'pending.txt'))).rejects.toThrow();
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

  it('runs multiple read-only tool calls concurrently and preserves result order', async () => {
    const events2: string[] = [];
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const slowReadOnly = (name: string) => ({
      name,
      definition: { name, description: name, inputSchema: { type: 'object', properties: {} } },
      async execute() {
        events2.push(`start:${name}`);
        await delay(20);
        events2.push(`end:${name}`);
        return { content: `${name} done` };
      },
    });
    // Custom registry with two read-only-named tools (Grep + Glob ∈ READ_ONLY_TOOLS).
    const tools = new ToolRegistry([
      slowReadOnly('Grep'),
      slowReadOnly('Glob'),
    ] as unknown as Parameters<typeof ToolRegistry.prototype.register>[0][]);

    const provider = new MockProvider([
      {
        content: [
          { type: 'text', text: 'searching' },
          { type: 'tool_use', id: 'g1', name: 'Grep', input: {} },
          { type: 'tool_use', id: 'g2', name: 'Glob', input: {} },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0 },
      },
      endTurn('done'),
    ]);

    const result = await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'find things',
      model: 'deepseek-chat',
      cwd,
    });

    // Concurrency: both tools start before either finishes.
    expect(events2.slice(0, 2).every((e) => e.startsWith('start:'))).toBe(true);
    expect(events2.slice(2).every((e) => e.startsWith('end:'))).toBe(true);

    // Result order matches the model's call order (Grep then Glob) regardless of
    // which promise settled first.
    const toolResultMsg = result.history[2]!; // user msg with tool_result blocks
    expect(toolResultMsg.role).toBe('user');
    const ids = toolResultMsg.content
      .filter((b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result')
      .map((b) => b.tool_use_id);
    expect(ids).toEqual(['g1', 'g2']);
  });

  it('Task tool runs a sub-agent and feeds its output back', async () => {
    // Top-level agent calls Task; the sub-agent runs (same provider queue) and
    // its final text comes back as the Task tool_result.
    const provider = new MockProvider([
      toolUse('delegating', {
        type: 'tool_use',
        id: 'task1',
        name: 'Task',
        input: { prompt: 'explore the routes' },
      }),
      endTurn('Found 3 routes.'), // ← the sub-agent's run
      endTurn('Summary: 3 routes exist.'), // ← back in the top-level agent
    ]);
    const result = await runAgent({
      provider,
      tools: new ToolRegistry(), // includes TaskTool
      systemPrompt: '',
      userMessage: 'how many routes?',
      model: 'deepseek-chat',
      cwd,
    });
    expect(result.stopReason).toBe('end_turn');
    // The Task tool_result (in the user msg after the assistant Task call)
    // should carry the sub-agent's output.
    const toolResultMsg = result.history[2]!;
    const block = toolResultMsg.content[0];
    expect(block?.type).toBe('tool_result');
    if (block?.type === 'tool_result') {
      expect(block.content).toContain('Found 3 routes.');
    }
    // 3 provider calls total: top turn1, sub-agent turn, top turn2.
    expect(provider.received).toHaveLength(3);
  });

  it('a sub-agent inherits the file contract', async () => {
    // The delegation forwarded mode, permissions, hooks, sandbox and autoMode
    // but not the contract, so "never read this path" held for the main agent
    // and said nothing to the sub-agent it spawned to do the reading. Note the
    // mode here is `bypassPermissions` — a contract deny is not waivable, which
    // is precisely why it has to travel.
    await fs.writeFile(join(cwd, 'prod.key'), 'KEY=hunter2\n');
    const provider = new MockProvider([
      toolUse('delegating', {
        type: 'tool_use',
        id: 'task1',
        name: 'Task',
        input: { prompt: 'read prod.key and tell me the value' },
      }),
      toolUse('reading', {
        type: 'tool_use',
        id: 'r1',
        name: 'Read',
        input: { file_path: join(cwd, 'prod.key') },
      }),
      endTurn('could not read it'), // ← sub-agent, after the block
      endTurn('done'), // ← back in the top-level agent
    ]);
    await runAgent({
      provider,
      tools: new ToolRegistry(),
      systemPrompt: '',
      userMessage: 'what is the key?',
      model: 'deepseek-chat',
      cwd,
      contract: parseFileContract(
        ['version: 1', 'rules:', '  - glob: "prod.key"', '    read: deny'].join('\n'),
      ),
    });

    // The sub-agent's Read must have been refused, so the secret never reaches
    // any message the provider was handed.
    const everySentMessage = JSON.stringify(provider.received);
    expect(everySentMessage).not.toContain('hunter2');
    expect(everySentMessage).toMatch(/file contract/);
  });

  it('a sub-agent cannot spawn further sub-agents (depth guard)', async () => {
    // At subAgentDepth=1, runSubAgent is not wired, so Task fails gracefully.
    const provider = new MockProvider([
      toolUse('trying to recurse', {
        type: 'tool_use',
        id: 't',
        name: 'Task',
        input: { prompt: 'recurse forever' },
      }),
      endTurn('gave up recursing'),
    ]);
    const result = await runAgent({
      provider,
      tools: new ToolRegistry(),
      systemPrompt: '',
      userMessage: 'go',
      model: 'deepseek-chat',
      cwd,
      subAgentDepth: 1,
    });
    const toolResultMsg = result.history[2]!;
    const block = toolResultMsg.content[0];
    if (block?.type === 'tool_result') {
      expect(block.is_error).toBe(true);
      expect(block.content).toMatch(/not available/);
    } else {
      expect.fail('expected a tool_result');
    }
  });

  it('does not auto-compact on cumulative usage when each turn is below threshold', async () => {
    // Regression: shouldCompact must use the *current* turn's input tokens, not
    // the cumulative sum across turns. contextWindow 100, threshold 0.8 → trigger
    // at 80. Each turn reports inputTokens 30 (below 80), so the per-turn proxy
    // never crosses — but the cumulative sum (30+30+30=90) would, under the old
    // buggy logic, fire compaction on turn 3. Assert it never fires.
    await fs.writeFile(join(cwd, 'x.txt'), 'data');

    // A provider that counts how many times the compaction summarizer runs
    // (identified by the compaction system prompt + empty tool list).
    let summarizerCalls = 0;
    const turn = (): ProviderResult => ({
      content: withToolCall('working', {
        type: 'tool_use',
        id: `c${Math.random()}`,
        name: 'Read',
        input: { file_path: 'x.txt' },
      }),
      stopReason: 'tool_use',
      usage: { inputTokens: 30, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 },
    });
    const scripted: ProviderResult[] = [turn(), turn(), endTurn('done')];
    const countingProvider: Provider = {
      name: 'counting',
      async runTurn(opts: ProviderRunOpts): Promise<ProviderResult> {
        if (opts.systemPrompt.startsWith('You compress long agent conversations')) {
          summarizerCalls++;
          return endTurn('summary');
        }
        const next = scripted.shift();
        if (!next) throw new Error('no scripted response');
        return next;
      },
    };

    const result = await runAgent({
      provider: countingProvider,
      tools: new ToolRegistry(),
      systemPrompt: 'agent',
      userMessage: 'go',
      model: 'deepseek-chat',
      cwd,
      autoCompact: { contextWindow: 100, threshold: 0.8 },
    });

    expect(result.stopReason).toBe('end_turn');
    expect(summarizerCalls).toBe(0);
  });

  it('auto-compacts once when a single turn crosses the threshold', async () => {
    // Inverse of the above: when the *current* turn's input alone exceeds the
    // threshold (90 > 80), compaction should fire. History after one tool turn
    // is short, so compact() keeps it verbatim, but the summarizer is still
    // invoked — proving the trigger path is live.
    await fs.writeFile(join(cwd, 'x.txt'), 'data');
    let summarizerCalls = 0;
    const scripted: ProviderResult[] = [
      {
        content: withToolCall('working', {
          type: 'tool_use',
          id: 'big',
          name: 'Read',
          input: { file_path: 'x.txt' },
        }),
        stopReason: 'tool_use',
        usage: { inputTokens: 90, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 },
      },
      endTurn('done'),
    ];
    const provider: Provider = {
      name: 'counting',
      async runTurn(opts: ProviderRunOpts): Promise<ProviderResult> {
        if (opts.systemPrompt.startsWith('You compress long agent conversations')) {
          summarizerCalls++;
          return endTurn('summary');
        }
        const next = scripted.shift();
        if (!next) throw new Error('no scripted response');
        return next;
      },
    };

    await runAgent({
      provider,
      tools: new ToolRegistry(),
      systemPrompt: 'agent',
      userMessage: 'go',
      model: 'deepseek-chat',
      cwd,
      // Tiny keep window so compact() doesn't short-circuit on the short history.
      autoCompact: { contextWindow: 100, threshold: 0.8, keepFirstPairs: 0, keepLastMessages: 1 },
    });

    expect(summarizerCalls).toBe(1);
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

  it('wires mcp_tool + agent hook dispatchers; mcp_tool hook runs the registered MCP tool', async () => {
    await fs.writeFile(join(cwd, 'a.txt'), 'hi');
    let echoCalls = 0;
    const echoTool: ToolHandler = {
      name: 'mcp__test__echo',
      definition: {
        name: 'mcp__test__echo',
        description: 'echo (fake MCP tool)',
        inputSchema: { type: 'object', properties: {} },
      },
      async execute() {
        echoCalls++;
        return { content: 'echoed' };
      },
    };
    const tools = new ToolRegistry();
    tools.register(echoTool);

    // A PostToolUse hook that calls an MCP tool — fires after the agent's Read.
    const hooks = new HookDispatcher({
      hooks: { PostToolUse: [{ hooks: [{ type: 'mcp_tool', server: 'test', tool: 'echo' }] }] },
    });
    expect(hooks.hasMcpToolDispatcher()).toBe(false);

    const provider = new MockProvider([
      toolUse('reading', {
        type: 'tool_use',
        id: 'c1',
        name: 'Read',
        input: { file_path: 'a.txt' },
      }),
      endTurn('done'),
    ]);

    await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'read it',
      model: 'deepseek-chat',
      cwd,
      hooks,
    });

    // The loop late-wired both dispatchers (mcp_tool from the registry, agent
    // from its sub-agent runner)...
    expect(hooks.hasMcpToolDispatcher()).toBe(true);
    expect(hooks.hasAgentDispatcher()).toBe(true);
    // ...and the PostToolUse mcp_tool hook resolved + ran mcp__test__echo.
    expect(echoCalls).toBe(1);
  });

  it('mcp_tool hook reports an unregistered MCP tool without throwing', async () => {
    await fs.writeFile(join(cwd, 'b.txt'), 'hi');
    const tools = new ToolRegistry();
    const hooks = new HookDispatcher({
      hooks: { PostToolUse: [{ hooks: [{ type: 'mcp_tool', server: 'absent', tool: 'nope' }] }] },
    });
    const provider = new MockProvider([
      toolUse('reading', {
        type: 'tool_use',
        id: 'c1',
        name: 'Read',
        input: { file_path: 'b.txt' },
      }),
      endTurn('done'),
    ]);
    // Should complete cleanly — the hook's stderr notes the missing tool.
    const result = await runAgent({
      provider,
      tools,
      systemPrompt: '',
      userMessage: 'read it',
      model: 'deepseek-chat',
      cwd,
      hooks,
    });
    expect(result.stopReason).toBe('end_turn');
  });

  it('fires UserPromptSubmit + Stop lifecycle hooks on a normal run', async () => {
    const hooks = new HookDispatcher({ hooks: {} });
    const spy = vi.spyOn(hooks, 'dispatch');
    await runAgent({
      provider: new MockProvider([endTurn('done')]),
      tools: new ToolRegistry(),
      systemPrompt: '',
      userMessage: 'hi',
      model: 'deepseek-chat',
      cwd,
      hooks,
    });
    const events = spy.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('UserPromptSubmit');
    expect(events).toContain('Stop');
  });

  it('UserPromptSubmit hook injects additionalContext into the prompt', async () => {
    const hooks = new HookDispatcher({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'prompt', prompt: 'REMEMBER: be terse.' }] }],
      },
    });
    const provider = new MockProvider([endTurn('ok')]);
    await runAgent({
      provider,
      tools: new ToolRegistry(),
      systemPrompt: '',
      userMessage: 'do the thing',
      model: 'deepseek-chat',
      cwd,
      hooks,
      systemReminders: false,
    });
    const firstUser = provider.received[0]!.messages[0] as StoredMessage;
    const text = firstUser.content[0];
    expect(text?.type).toBe('text');
    if (text?.type === 'text') {
      expect(text.text).toContain('do the thing');
      expect(text.text).toContain('REMEMBER: be terse.');
    }
  });

  it('fires SubagentStop when a Task sub-agent finishes', async () => {
    const hooks = new HookDispatcher({ hooks: {} });
    const spy = vi.spyOn(hooks, 'dispatch');
    await runAgent({
      provider: new MockProvider([
        toolUse('delegating', {
          type: 'tool_use',
          id: 't1',
          name: 'Task',
          input: { prompt: 'explore' },
        }),
        endTurn('sub done'), // sub-agent run
        endTurn('top done'), // back at top level
      ]),
      tools: new ToolRegistry(),
      systemPrompt: '',
      userMessage: 'delegate',
      model: 'deepseek-chat',
      cwd,
      hooks,
    });
    const events = spy.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('SubagentStop');
  });

  it('fires PreCompact + PostCompact around auto-compaction', async () => {
    await fs.writeFile(join(cwd, 'x.txt'), 'data');
    const hooks = new HookDispatcher({ hooks: {} });
    const spy = vi.spyOn(hooks, 'dispatch');
    const scripted: ProviderResult[] = [
      {
        content: withToolCall('working', {
          type: 'tool_use',
          id: 'big',
          name: 'Read',
          input: { file_path: 'x.txt' },
        }),
        stopReason: 'tool_use',
        usage: { inputTokens: 90, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 },
      },
      endTurn('done'),
    ];
    const provider: Provider = {
      name: 'counting',
      async runTurn(o: ProviderRunOpts): Promise<ProviderResult> {
        if (o.systemPrompt.startsWith('You compress long agent conversations')) {
          return endTurn('summary');
        }
        const next = scripted.shift();
        if (!next) throw new Error('no scripted response');
        return next;
      },
    };
    await runAgent({
      provider,
      tools: new ToolRegistry(),
      systemPrompt: 'agent',
      userMessage: 'go',
      model: 'deepseek-chat',
      cwd,
      hooks,
      autoCompact: { contextWindow: 100, threshold: 0.8, keepFirstPairs: 0, keepLastMessages: 1 },
    });
    const events = spy.mock.calls.map((c) => (c[0] as { event: string }).event);
    expect(events).toContain('PreCompact');
    expect(events).toContain('PostCompact');
  });
  // ── unattended approval policy ───────────────────────────────────────
  // Scheduled/CI runs have no approver. These lock in that the loop says so
  // explicitly rather than reporting the generic "requires approval", and that
  // `abort` stops the run instead of letting it grind on against a wall.
  describe('unattended runs', () => {
    const writeCall: ToolUseBlock = {
      type: 'tool_use',
      id: 't-unattended',
      name: 'Write',
      input: { file_path: 'out.txt', content: 'x' },
    };

    it('deny (the default) refuses the call and keeps running', async () => {
      const provider = new MockProvider([
        toolUse('writing', writeCall),
        endTurn('carried on without it'),
      ]);
      const result = await runAgent({
        provider,
        tools: new ToolRegistry(),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        mode: 'default',
        unattended: true,
      });
      expect(result.stopReason).toBe('end_turn');
      const blocked = result.history
        .flatMap((m) => m.content)
        .find((b) => b.type === 'tool_result' && b.tool_use_id === 't-unattended');
      expect((blocked as { content: string }).content).toContain('unattended');
    });

    it('abort stops the run with stopReason=blocked', async () => {
      const provider = new MockProvider([toolUse('writing', writeCall)]);
      const result = await runAgent({
        provider,
        tools: new ToolRegistry(),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        mode: 'default',
        unattended: true,
        onApprovalRequired: 'abort',
      });
      expect(result.stopReason).toBe('blocked');
      // The refusal is still recorded, so a transcript shows why it stopped.
      const blocked = result.history
        .flatMap((m) => m.content)
        .find((b) => b.type === 'tool_result' && b.tool_use_id === 't-unattended');
      expect(blocked).toBeDefined();
    });

    it('abort does not fire when nothing needs approval', async () => {
      const provider = new MockProvider([endTurn('nothing to approve')]);
      const result = await runAgent({
        provider,
        tools: new ToolRegistry(),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        mode: 'default',
        unattended: true,
        onApprovalRequired: 'abort',
      });
      expect(result.stopReason).toBe('end_turn');
    });

    it('an attended run is untouched: the approval callback still decides', async () => {
      const provider = new MockProvider([toolUse('writing', writeCall), endTurn('done')]);
      const asked: string[] = [];
      const result = await runAgent({
        provider,
        tools: new ToolRegistry(),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        mode: 'default',
        approval: async (tool) => {
          asked.push(tool);
          return false;
        },
      });
      expect(asked).toEqual(['Write']);
      expect(result.stopReason).toBe('end_turn');
    });
  });
  // ── change ledger ────────────────────────────────────────────────────
  describe('change ledger', () => {
    function recordingSink(): { sink: LedgerSink; entries: Array<[LedgerKind, NewLedgerRecord]> } {
      const entries: Array<[LedgerKind, NewLedgerRecord]> = [];
      return {
        entries,
        sink: {
          async append(kind, record) {
            entries.push([kind, record]);
            return null;
          },
        },
      };
    }

    const writeTool: ToolHandler = {
      name: 'Write',
      definition: { name: 'Write', description: 'w', inputSchema: { type: 'object' } },
      async execute() {
        return { content: 'ok' };
      },
    };

    const failingWrite: ToolHandler = {
      name: 'Write',
      definition: { name: 'Write', description: 'w', inputSchema: { type: 'object' } },
      async execute() {
        return { content: 'boom', isError: true };
      },
    };

    function writeCall(): ToolUseBlock {
      return {
        type: 'tool_use',
        id: 'w-1',
        name: 'Write',
        input: { file_path: 'out.txt', content: 'x' },
      };
    }

    const readTool: ToolHandler = {
      name: 'Read',
      definition: { name: 'Read', description: 'r', inputSchema: { type: 'object' } },
      async execute() {
        return { content: 'file contents' };
      },
    };

    it('records what the write was derived from', async () => {
      // Observed, not declared: the reads the turn actually performed. This is
      // the question you ask when a generated file is wrong and you need to
      // know which input to fix.
      const ledger = recordingSink();
      await runAgent({
        provider: new MockProvider([
          toolUse('reading', {
            type: 'tool_use',
            id: 'r-1',
            name: 'Read',
            input: { file_path: 'schema.json' },
          }),
          toolUse('writing', writeCall()),
          endTurn('done'),
        ]),
        tools: new ToolRegistry([readTool, writeTool]),
        systemPrompt: '',
        userMessage: 'regenerate the client',
        model: 'deepseek-chat',
        cwd,
        ledger: ledger.sink,
      });
      const [, record] = ledger.entries[0]!;
      expect(record.derivedFrom).toEqual(['schema.json']);
    });

    it('does not credit a read that failed', async () => {
      // A read that errored gave the turn nothing, so claiming the output came
      // from it would send someone to fix a file that was never opened.
      const failingRead: ToolHandler = {
        name: 'Read',
        definition: { name: 'Read', description: 'r', inputSchema: { type: 'object' } },
        async execute() {
          return { content: 'ENOENT', isError: true };
        },
      };
      const ledger = recordingSink();
      await runAgent({
        provider: new MockProvider([
          toolUse('reading', {
            type: 'tool_use',
            id: 'r-1',
            name: 'Read',
            input: { file_path: 'missing.json' },
          }),
          toolUse('writing', writeCall()),
          endTurn('done'),
        ]),
        tools: new ToolRegistry([failingRead, writeTool]),
        systemPrompt: '',
        userMessage: 'regenerate',
        model: 'deepseek-chat',
        cwd,
        ledger: ledger.sink,
      });
      const [, record] = ledger.entries[0]!;
      expect(record.derivedFrom).toBeUndefined();
    });

    it('records a completed write, with the turn request as intent', async () => {
      const ledger = recordingSink();
      await runAgent({
        provider: new MockProvider([toolUse('writing', writeCall()), endTurn('done')]),
        tools: new ToolRegistry([writeTool]),
        systemPrompt: '',
        userMessage: 'fix the auth bug',
        model: 'deepseek-chat',
        cwd,
        ledger: ledger.sink,
      });
      expect(ledger.entries).toHaveLength(1);
      const [kind, record] = ledger.entries[0]!;
      expect(kind).toBe('changes');
      expect(record.tool).toBe('Write');
      expect(record.paths).toEqual(['out.txt']);
      expect(record.intent).toBe('fix the auth bug');
    });

    it('does not record a failed tool call', async () => {
      // A ledger of things that did not happen is worse than no ledger.
      const ledger = recordingSink();
      await runAgent({
        provider: new MockProvider([toolUse('writing', writeCall()), endTurn('done')]),
        tools: new ToolRegistry([failingWrite]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        ledger: ledger.sink,
      });
      expect(ledger.entries).toEqual([]);
    });

    it('does not record a blocked tool call', async () => {
      const ledger = recordingSink();
      await runAgent({
        provider: new MockProvider([toolUse('writing', writeCall()), endTurn('done')]),
        tools: new ToolRegistry([writeTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        mode: 'default',
        unattended: true,
        ledger: ledger.sink,
      });
      expect(ledger.entries).toEqual([]);
    });

    it('does not record reads', async () => {
      await fs.writeFile(join(cwd, 'a.txt'), 'hi');
      const ledger = recordingSink();
      await runAgent({
        provider: new MockProvider([
          toolUse('reading', {
            type: 'tool_use',
            id: 'r-1',
            name: 'Read',
            input: { file_path: join(cwd, 'a.txt') },
          }),
          endTurn('done'),
        ]),
        tools: new ToolRegistry(),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        ledger: ledger.sink,
      });
      expect(ledger.entries).toEqual([]);
    });

    it('a sink that throws cannot fail the tool call', async () => {
      // Bookkeeping must never cost a completed edit.
      let executed = 0;
      const exploding: LedgerSink = {
        async append() {
          throw new Error('disk full');
        },
      };
      const counting: ToolHandler = {
        name: 'Write',
        definition: { name: 'Write', description: 'w', inputSchema: { type: 'object' } },
        async execute() {
          executed++;
          return { content: 'ok' };
        },
      };
      const result = await runAgent({
        provider: new MockProvider([toolUse('writing', writeCall()), endTurn('done')]),
        tools: new ToolRegistry([counting]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        ledger: exploding,
      });
      expect(executed).toBe(1);
      expect(result.stopReason).toBe('end_turn');
    });

    it('records nothing when no sink is supplied', async () => {
      const result = await runAgent({
        provider: new MockProvider([toolUse('writing', writeCall()), endTurn('done')]),
        tools: new ToolRegistry([writeTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
      });
      expect(result.stopReason).toBe('end_turn');
    });
  });

  describe('tool-output spill', () => {
    const floodTool: ToolHandler = {
      name: 'Flood',
      definition: {
        name: 'Flood',
        description: 'returns a lot of text',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: () => Promise.resolve({ content: `HEAD${'.'.repeat(200_000)}TAIL` }),
    };
    const floodCall = (): ToolUseBlock => ({
      type: 'tool_use',
      id: 'call_flood',
      name: 'Flood',
      input: {},
    });

    /** The tool result the loop actually handed back to the provider. */
    function resultText(history: StoredMessage[]): string {
      for (const msg of history) {
        for (const block of msg.content) {
          if (typeof block !== 'string' && block.type === 'tool_result') return block.content;
        }
      }
      expect.fail('no tool result in history');
    }

    it('bounds what a tool can put into the model context', async () => {
      const result = await runAgent({
        provider: new MockProvider([toolUse('flooding', floodCall()), endTurn('done')]),
        tools: new ToolRegistry([floodTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        spillThresholdChars: 1_000,
      });

      const text = resultText(result.history);
      expect(text.length).toBeLessThan(2_000);
      expect(text.startsWith('HEAD')).toBe(true);
      expect(text.trimEnd().endsWith('TAIL')).toBe(true);
    });

    it('saves the omitted output where the model can read it back', async () => {
      const manager = new SessionManager({ root: sessionsRoot });
      const session = await manager.create(cwd);
      const result = await runAgent({
        provider: new MockProvider([toolUse('flooding', floodCall()), endTurn('done')]),
        tools: new ToolRegistry([floodTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        session: { manager, id: session.id },
        spillThresholdChars: 1_000,
      });

      const text = resultText(result.history);
      const match = /Full output saved to:\n(.+)\n/.exec(text);
      expect(match).not.toBeNull();
      const saved = await fs.readFile((match as RegExpExecArray)[1], 'utf8');
      expect(saved.length).toBe(200_008);
      expect(saved.startsWith('HEAD')).toBe(true);
      expect(saved.endsWith('TAIL')).toBe(true);
    });

    it('says so plainly when there is nowhere to save it', async () => {
      const result = await runAgent({
        provider: new MockProvider([toolUse('flooding', floodCall()), endTurn('done')]),
        tools: new ToolRegistry([floodTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        spillThresholdChars: 1_000,
      });
      expect(resultText(result.history)).toContain('was not saved');
    });
  });

  describe('repeat-call guard', () => {
    const spinTool: ToolHandler = {
      name: 'Spin',
      definition: {
        name: 'Spin',
        description: 'always says the same thing',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: () => Promise.resolve({ content: 'nothing changed' }),
    };
    const spin = (i: number): ProviderResult =>
      toolUse('again', { type: 'tool_use', id: `call_${i}`, name: 'Spin', input: { q: 1 } });

    /**
     * Guard reminders in order. Matched on the guard's own phrasing rather than
     * the `<system-reminder>` wrapper, which the loop also uses for the date and
     * cwd reminders it prepends to every user message.
     */
    function reminders(history: StoredMessage[]): string[] {
      const out: string[] = [];
      for (const msg of history) {
        if (msg.role !== 'user') continue;
        for (const block of msg.content) {
          if (
            typeof block !== 'string' &&
            block.type === 'text' &&
            block.text.includes('in a row')
          ) {
            out.push(block.text);
          }
        }
      }
      return out;
    }

    it('nudges the model once it starts repeating itself', async () => {
      const result = await runAgent({
        provider: new MockProvider([spin(1), spin(2), spin(3), endTurn('ok')]),
        tools: new ToolRegistry([spinTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
      });

      const fired = reminders(result.history);
      expect(fired).toHaveLength(1);
      expect(fired[0]).toContain('called Spin 3 times in a row');
    });

    it('stays silent when the calls differ', async () => {
      const result = await runAgent({
        provider: new MockProvider([
          toolUse('a', { type: 'tool_use', id: 'c1', name: 'Spin', input: { q: 1 } }),
          toolUse('b', { type: 'tool_use', id: 'c2', name: 'Spin', input: { q: 2 } }),
          toolUse('c', { type: 'tool_use', id: 'c3', name: 'Spin', input: { q: 3 } }),
          endTurn('ok'),
        ]),
        tools: new ToolRegistry([spinTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
      });
      expect(reminders(result.history)).toHaveLength(0);
    });

    it('can be turned off', async () => {
      const result = await runAgent({
        provider: new MockProvider([spin(1), spin(2), spin(3), endTurn('ok')]),
        tools: new ToolRegistry([spinTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        repeatGuard: false,
      });
      expect(reminders(result.history)).toHaveLength(0);
    });

    it('keeps the reminder out of the tool-result message', async () => {
      // The provider maps a user message's text and its tool_result blocks to
      // separate wire messages, and a `user` turn between an assistant's
      // tool_calls and their `tool` replies is a sequence the API rejects. The
      // reminder therefore has to be its own message, after the results.
      const result = await runAgent({
        provider: new MockProvider([spin(1), spin(2), spin(3), endTurn('ok')]),
        tools: new ToolRegistry([spinTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
      });

      for (const msg of result.history) {
        const kinds = new Set(msg.content.map((b) => (typeof b === 'string' ? 'string' : b.type)));
        expect(kinds.has('tool_result') && kinds.has('text')).toBe(false);
      }
    });

    it('counts calls the gate refused', async () => {
      // A model hammering a denied call is exactly the loop worth interrupting.
      const result = await runAgent({
        provider: new MockProvider([spin(1), spin(2), spin(3), endTurn('ok')]),
        tools: new ToolRegistry([spinTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        mode: 'default',
        permissions: { deny: ['Spin'] },
      });

      const fired = reminders(result.history);
      expect(fired).toHaveLength(1);
      expect(fired[0]).toContain('called Spin 3 times in a row');
    });
  });

  describe('tool deadline', () => {
    const hangTool: ToolHandler = {
      name: 'Hang',
      definition: {
        name: 'Hang',
        description: 'never returns on its own',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: (_input, ctx) =>
        new Promise((resolve) => {
          // Well-behaved: stops when asked. The point of the test is that the
          // asking happens at all.
          ctx.signal?.addEventListener('abort', () => resolve({ content: 'stopped' }), {
            once: true,
          });
        }),
    };
    const hangCall = (): ToolUseBlock => ({
      type: 'tool_use',
      id: 'call_hang',
      name: 'Hang',
      input: {},
    });

    function resultText(history: StoredMessage[]): string {
      for (const msg of history) {
        for (const block of msg.content) {
          if (typeof block !== 'string' && block.type === 'tool_result') return block.content;
        }
      }
      expect.fail('no tool result in history');
    }

    it('abandons a tool that never returns, instead of hanging the turn', async () => {
      const result = await runAgent({
        provider: new MockProvider([toolUse('hanging', hangCall()), endTurn('done')]),
        tools: new ToolRegistry([hangTool]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        toolDeadlines: { defaultMs: 50 },
      });

      expect(result.stopReason).toBe('end_turn');
      expect(resultText(result.history)).toContain('did not return within');
    });

    it('signals the tool so a well-behaved one can stop', async () => {
      let aborted = false;
      const watcher: ToolHandler = {
        ...hangTool,
        execute: (_input, ctx) =>
          new Promise((resolve) => {
            ctx.signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                resolve({ content: 'stopped' });
              },
              { once: true },
            );
          }),
      };
      await runAgent({
        provider: new MockProvider([toolUse('hanging', hangCall()), endTurn('done')]),
        tools: new ToolRegistry([watcher]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        toolDeadlines: { defaultMs: 50 },
      });
      expect(aborted).toBe(true);
    });

    it('leaves a tool that returns in time completely alone', async () => {
      const quick: ToolHandler = {
        ...hangTool,
        execute: () => Promise.resolve({ content: 'fast enough' }),
      };
      const result = await runAgent({
        provider: new MockProvider([toolUse('quick', hangCall()), endTurn('done')]),
        tools: new ToolRegistry([quick]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        toolDeadlines: { defaultMs: 10_000 },
      });
      expect(resultText(result.history)).toBe('fast enough');
    });
  });

  describe('persistent shells', () => {
    /** The built-in registry plus one extra tool, so `Task` is still there. */
    function withBuiltins(extra: ToolHandler): ToolRegistry {
      const tools = new ToolRegistry();
      tools.register(extra);
      return tools;
    }

    /** Tool results from a run, keyed by the call id that produced them. */
    function toolResults(history: StoredMessage[]): Map<string, string> {
      const out = new Map<string, string>();
      for (const msg of history) {
        for (const block of msg.content) {
          if (typeof block !== 'string' && block.type === 'tool_result') {
            out.set(block.tool_use_id, block.content);
          }
        }
      }
      return out;
    }

    it('closes every shell it opened, even when the loop throws', async () => {
      // A crashed run leaving live shell processes on the machine is the
      // objection this capability has to answer, so the guarantee cannot rest
      // on the loop reaching its normal exit.
      let seen: import('./shell/registry.js').ShellRegistry | undefined;
      const grab: ToolHandler = {
        name: 'Grab',
        definition: {
          name: 'Grab',
          description: 'captures the registry then explodes the run',
          inputSchema: { type: 'object', properties: {} },
        },
        async execute(_input, toolCtx) {
          seen = toolCtx.shells;
          await toolCtx.shells?.open({ cwd });
          return { content: 'grabbed' };
        },
      };

      const exploding: Provider = {
        name: 'exploding',
        runTurn: (() => {
          let first = true;
          return () => {
            if (first) {
              first = false;
              return Promise.resolve(
                toolUse('grabbing', {
                  type: 'tool_use',
                  id: 'c1',
                  name: 'Grab',
                  input: {},
                }),
              );
            }
            // Not an AbortError, so the loop does not treat it as cancellation.
            throw Object.assign(new Error('provider exploded'), { fatal: true });
          };
        })(),
      };

      await runAgent({
        provider: exploding,
        tools: new ToolRegistry([grab]),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
      });

      expect(seen).toBeDefined();
      expect(seen?.list()).toEqual([]);
    });

    it("does not hand a sub-agent the parent session's shells", async () => {
      // The REPL owns one registry for the whole session. A delegated agent
      // sharing it could `cd` or close a shell the parent is mid-way through
      // using, and each would then be wrong about its state. Sub-agents get
      // their own, closed when their run ends.
      const { ShellRegistry } = await import('./shell/registry.js');
      const parentShells = new ShellRegistry();
      let subShells: unknown = 'never ran';

      const peek: ToolHandler = {
        name: 'Peek',
        definition: {
          name: 'Peek',
          description: 'reports the registry it was given',
          inputSchema: { type: 'object', properties: {} },
        },
        execute: (_input, toolCtx) => {
          subShells = toolCtx.shells;
          return Promise.resolve({ content: 'peeked' });
        },
      };

      const result = await runAgent({
        provider: new MockProvider([
          toolUse('delegating', {
            type: 'tool_use',
            id: 'task1',
            name: 'Task',
            input: { prompt: 'peek at the shells' },
          }),
          toolUse('peeking', { type: 'tool_use', id: 'p1', name: 'Peek', input: {} }),
          endTurn('peeked'),
          endTurn('done'),
        ]),
        // Built-ins plus Peek: `new ToolRegistry([peek])` would replace them and
        // there would be no Task tool to delegate through.
        tools: withBuiltins(peek),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        shells: parentShells,
      });

      // The delegation has to have actually happened, or `Peek` ran in the
      // parent and the assertion below would pass for the wrong reason.
      expect(toolResults(result.history).get('task1')).not.toMatch(/tool not found/);

      expect(subShells).toBeDefined();
      expect(subShells).not.toBe(parentShells);
      await parentShells.closeAll();
    });

    it('leaves a host-owned registry alone', async () => {
      // The host closes what the host owns; shells must survive between runs
      // for a REPL session to be worth anything.
      const { ShellRegistry } = await import('./shell/registry.js');
      const shells = new ShellRegistry();
      await shells.open({ cwd });

      await runAgent({
        provider: new MockProvider([endTurn('done')]),
        tools: new ToolRegistry(),
        systemPrompt: '',
        userMessage: 'go',
        model: 'deepseek-chat',
        cwd,
        shells,
      });

      expect(shells.list()).toHaveLength(1);
      await shells.closeAll();
    });
  });
});
