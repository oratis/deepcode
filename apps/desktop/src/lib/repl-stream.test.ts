import { describe, expect, it } from 'vitest';
import {
  appendReasoningDelta,
  appendTextDelta,
  appendToolUse,
  attachToolResult,
  finalizeStreaming,
  lastAssistantIndex,
  pickTarget,
  storedToMsgs,
  threadReviewItems,
  threadToMsgs,
  type AssistantMsg,
  type Msg,
  type ToolInvocation,
} from './repl-stream.js';

const tool = (id: string, name: string): ToolInvocation => ({
  toolId: id,
  name,
  input: {},
  status: 'running',
});

function streamingTurns(msgs: Msg[]): number {
  return msgs.filter((m) => m.role === 'assistant' && m.turn.streaming).length;
}

describe('repl-stream mutators', () => {
  it('appends text deltas into a single streaming turn', () => {
    let m: Msg[] = [{ role: 'system', text: 'ready' }];
    m = appendTextDelta(m, 'Hel');
    m = appendTextDelta(m, 'lo');
    expect(m).toHaveLength(2);
    expect(m[1]).toMatchObject({ role: 'assistant', turn: { text: 'Hello', streaming: true } });
  });

  it('places the answer after tools and a system note with only one cursor', () => {
    let m: Msg[] = [{ role: 'user', text: 'write a game' }];
    m = appendTextDelta(m, 'Creating files');
    m = appendToolUse(m, tool('w1', 'Write'));
    // User clicks "always allow" → a system note is pushed mid-turn.
    m.push({ role: 'system', text: '✓ "Write" added to settings.permissions.allow' });
    // The model keeps streaming the next agent-loop turn.
    m = appendTextDelta(m, 'The file is ready.');
    m = appendToolUse(m, tool('w2', 'Write'));

    expect(streamingTurns(m)).toBe(1);
    expect(m).toMatchObject([
      { role: 'user' },
      {
        role: 'assistant',
        turn: {
          text: 'Creating files',
          streaming: false,
          tools: [{ toolId: 'w1', status: 'running' }],
        },
      },
      { role: 'system', text: '✓ "Write" added to settings.permissions.allow' },
      {
        role: 'assistant',
        turn: { text: 'The file is ready.', streaming: true, tools: [{ toolId: 'w2' }] },
      },
    ]);
  });

  it('keeps text continuous across a system note when no tool intervenes', () => {
    let m = appendTextDelta([], 'Hello');
    m.push({ role: 'system', text: 'status note' });
    m = appendTextDelta(m, ' world');
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ role: 'assistant', turn: { text: 'Hello world' } });
    expect(streamingTurns(m)).toBe(1);
  });

  it('preserves text-tool-text order across multiple model steps', () => {
    let m = appendTextDelta([], 'I will read the configuration.');
    m = appendToolUse(m, tool('read', 'Read'));
    m = attachToolResult(m, 'read', 'current configuration', 'ok');
    m = appendTextDelta(m, 'It needs an update.');
    m = appendToolUse(m, tool('edit', 'Edit'));
    m = attachToolResult(m, 'edit', 'saved', 'ok');
    m = appendTextDelta(m, 'The update is');
    m = appendTextDelta(m, ' complete.');
    expect(m).toMatchObject([
      {
        role: 'assistant',
        turn: {
          text: 'I will read the configuration.',
          streaming: false,
          tools: [{ toolId: 'read', status: 'ok' }],
        },
      },
      {
        role: 'assistant',
        turn: {
          text: 'It needs an update.',
          streaming: false,
          tools: [{ toolId: 'edit', status: 'ok' }],
        },
      },
      { role: 'assistant', turn: { text: 'The update is complete.', streaming: true, tools: [] } },
    ]);
    expect(streamingTurns(m)).toBe(1);
  });

  it('matches delayed results across chunks without settling another running tool', () => {
    let m = appendToolUse([], tool('first', 'Read'));
    m = appendTextDelta(m, 'Checking the next file.');
    m = appendToolUse(m, tool('second', 'Grep'));
    m = appendTextDelta(m, 'Collecting results.');
    const before = m;
    m = attachToolResult(m, 'first', 'first body', 'ok');
    expect((m[0] as AssistantMsg).turn.tools[0]).toMatchObject({
      toolId: 'first',
      status: 'ok',
      resultText: 'first body',
    });
    expect((m[1] as AssistantMsg).turn.tools[0]).toMatchObject({
      toolId: 'second',
      status: 'running',
    });
    expect((before[0] as AssistantMsg).turn.tools[0]?.status).toBe('running');
    m = attachToolResult(m, 'second', 'grep failed', 'err');
    expect((m[1] as AssistantMsg).turn.tools[0]).toMatchObject({
      toolId: 'second',
      status: 'err',
      resultText: 'grep failed',
    });
    expect((m[2] as AssistantMsg).turn.text).toBe('Collecting results.');
    expect(streamingTurns(m)).toBe(1);
  });

  it('does not split a tool chunk for an empty streaming delta', () => {
    const m = appendToolUse([], tool('read', 'Read'));
    expect(appendTextDelta(m, '')).toBe(m);
    expect(appendReasoningDelta(m, '')).toBe(m);
  });

  it('attaches tool results to the matching card by id', () => {
    let m: Msg[] = [];
    m = appendToolUse(m, tool('a', 'Read'));
    m = appendToolUse(m, tool('b', 'Grep'));
    m = attachToolResult(m, 'b', 'grep output', 'ok');
    const turn = m[0]!;
    if (turn.role !== 'assistant') throw new Error('expected assistant');
    expect(turn.turn.tools[0]).toMatchObject({ toolId: 'a', status: 'running' });
    expect(turn.turn.tools[1]).toMatchObject({
      toolId: 'b',
      status: 'ok',
      resultText: 'grep output',
    });
  });

  it('keeps a result’s locations on the card, and omits the key when there are none', () => {
    let m: Msg[] = [];
    m = appendToolUse(m, tool('a', 'Grep'));
    m = appendToolUse(m, tool('b', 'Read'));
    m = attachToolResult(m, 'a', '/repo/x.ts:1:hit', 'ok', [
      { path: '/repo/x.ts', line: 1, preview: 'hit' },
    ]);
    // A restored session replays results without structured data — the card
    // must not grow a `locations: []` that reads as "searched, found nothing".
    m = attachToolResult(m, 'b', 'file contents', 'ok', []);
    const turn = m[0]!;
    if (turn.role !== 'assistant') throw new Error('expected assistant');
    expect(turn.turn.tools[0]!.locations).toEqual([
      { path: '/repo/x.ts', line: 1, preview: 'hit' },
    ]);
    expect('locations' in turn.turn.tools[1]!).toBe(false);
  });

  it('falls back to only the newest running tool across resumed turns', () => {
    const m: Msg[] = [
      {
        role: 'assistant',
        turn: { text: 'old', tools: [tool('old', 'Write')], streaming: false },
      },
      { role: 'user', text: 'next turn' },
      {
        role: 'assistant',
        turn: { text: 'new', tools: [tool('new', 'Edit')], streaming: true },
      },
    ];

    const out = attachToolResult(m, 'provider-changed-id', 'updated', 'ok');
    const oldTurn = out[0];
    const newTurn = out[2];
    if (oldTurn?.role !== 'assistant' || newTurn?.role !== 'assistant') {
      throw new Error('expected assistant turns');
    }
    expect(oldTurn.turn.tools[0]).toMatchObject({ toolId: 'old', status: 'running' });
    expect(newTurn.turn.tools[0]).toMatchObject({
      toolId: 'new',
      status: 'ok',
      resultText: 'updated',
    });
  });

  it('finalizeStreaming clears the flag on ALL assistant turns', () => {
    // Even if a prior turn was left streaming (defensive), finalize clears it.
    const m: Msg[] = [
      { role: 'assistant', turn: { text: 'a', tools: [], streaming: true } },
      { role: 'system', text: 'note' },
      { role: 'assistant', turn: { text: 'b', tools: [], streaming: true } },
    ];
    const out = finalizeStreaming(m);
    expect(streamingTurns(out)).toBe(0);
  });

  it.each([
    [false, 'unknown'],
    [true, 'interrupted'],
  ] as const)(
    'settles missing tool results across every chunk (interrupted=%s)',
    (interrupted, status) => {
      let m = appendToolUse([], tool('first', 'Write'));
      m = appendToolUse(m, { ...tool('done', 'Read'), status: 'ok', resultText: 'read body' });
      m = appendTextDelta(m, 'More work');
      m = appendToolUse(m, tool('second', 'Edit'));
      m = appendToolUse(m, { ...tool('failed', 'Bash'), status: 'err', resultText: 'failed' });
      m = appendTextDelta(m, 'Finishing');
      const out = finalizeStreaming(m, interrupted);
      expect(streamingTurns(out)).toBe(0);
      expect((out[0] as AssistantMsg).turn.tools).toMatchObject([
        { toolId: 'first', status },
        { toolId: 'done', status: 'ok', resultText: 'read body' },
      ]);
      expect((out[1] as AssistantMsg).turn.tools).toMatchObject([
        { toolId: 'second', status },
        { toolId: 'failed', status: 'err', resultText: 'failed' },
      ]);
      expect((m[0] as AssistantMsg).turn.tools[0]?.status).toBe('running');
    },
  );

  it('lastAssistantIndex skips trailing system / user messages', () => {
    const m: Msg[] = [
      { role: 'assistant', turn: { text: 'x', tools: [], streaming: true } },
      { role: 'system', text: 'note' },
    ];
    expect(lastAssistantIndex(m)).toBe(0);
    expect(lastAssistantIndex([{ role: 'system', text: 'only' }])).toBe(-1);
  });

  it('storedToMsgs reconstructs a resumed conversation (text + tool cards + results)', () => {
    const stored = [
      { role: 'user' as const, content: [{ type: 'text', text: 'read a.txt' }] },
      {
        role: 'assistant' as const,
        content: [
          { type: 'thinking', text: 'internal — should be dropped' },
          { type: 'text', text: 'Reading it.' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.txt' } },
        ],
      },
      {
        role: 'user' as const,
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'file body', is_error: false },
        ],
      },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'Done.' }] },
    ];
    const msgs = storedToMsgs(stored);
    expect(msgs).toHaveLength(3); // user, assistant(+tool), assistant
    expect(msgs[0]).toEqual({ role: 'user', text: 'read a.txt' });
    const a1 = msgs[1];
    if (a1?.role !== 'assistant') throw new Error('expected assistant');
    expect(a1.turn.text).toBe('Reading it.'); // thinking dropped
    expect(a1.turn.streaming).toBe(false);
    expect(a1.turn.tools[0]).toMatchObject({
      toolId: 't1',
      name: 'Read',
      target: 'a.txt',
      status: 'ok',
      resultText: 'file body',
    });
    expect(msgs[2]).toMatchObject({ role: 'assistant', turn: { text: 'Done.' } });
  });

  it('storedToMsgs marks errored tool results', () => {
    const msgs = storedToMsgs([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'x', content: 'boom', is_error: true }],
      },
    ]);
    const a = msgs[0];
    if (a?.role !== 'assistant') throw new Error('expected assistant');
    expect(a.turn.tools[0]).toMatchObject({ status: 'err', resultText: 'boom' });
  });

  it('restores interleaved text/tool blocks in order and attaches results across chunks', () => {
    const msgs = storedToMsgs([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'First read.' },
          { type: 'tool_use', id: 'read', name: 'Read', input: {} },
          { type: 'text', text: 'Then edit.' },
          { type: 'tool_use', id: 'edit', name: 'Edit', input: {} },
          { type: 'text', text: 'Finished.' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'edit', content: 'saved' },
          { type: 'tool_result', tool_use_id: 'read', content: 'body' },
        ],
      },
    ]);
    expect(msgs).toMatchObject([
      {
        role: 'assistant',
        turn: {
          text: 'First read.',
          streaming: false,
          tools: [{ toolId: 'read', status: 'ok', resultText: 'body' }],
        },
      },
      {
        role: 'assistant',
        turn: {
          text: 'Then edit.',
          streaming: false,
          tools: [{ toolId: 'edit', status: 'ok', resultText: 'saved' }],
        },
      },
      { role: 'assistant', turn: { text: 'Finished.', streaming: false, tools: [] } },
    ]);
  });

  it('restores a missing historical tool result as unknown, never running or successful', () => {
    const msgs = storedToMsgs([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'lost', name: 'Write', input: {} }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Partial answer' }] },
    ]);
    expect((msgs[0] as AssistantMsg).turn.tools[0]).toMatchObject({
      toolId: 'lost',
      status: 'unknown',
    });
    expect((msgs[0] as AssistantMsg).turn.tools[0]?.resultText).toBeUndefined();
    expect(streamingTurns(msgs)).toBe(0);
  });

  it('pickTarget surfaces the most relevant field', () => {
    expect(pickTarget({ file_path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(pickTarget({ command: 'ls -la' })).toBe('ls -la');
    expect(pickTarget({ irrelevant: 1 })).toBeUndefined();
  });
});

describe('threadToMsgs', () => {
  const turn = (items: Array<{ type: string; payload: Record<string, unknown> }>) => ({
    turns: [{ items }],
  });

  it('projects a user message', () => {
    expect(threadToMsgs(turn([{ type: 'user_message', payload: { text: 'hi' } }]))).toEqual([
      { role: 'user', text: 'hi' },
    ]);
  });

  it('attaches a tool result to the assistant turn that issued the call', () => {
    const msgs = threadToMsgs(
      turn([
        {
          type: 'assistant_message',
          payload: {
            message: {
              role: 'assistant',
              content: [
                { type: 'text', text: 'Reading.' },
                { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
              ],
            },
          },
        },
        {
          type: 'tool_result',
          payload: {
            message: {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }],
            },
          },
        },
      ]),
    );
    const assistant = msgs.find((m) => m.role === 'assistant') as AssistantMsg;
    expect(assistant.turn.tools).toHaveLength(1);
    // The result must land on the existing card, not create a second turn.
    expect(assistant.turn.tools[0]!.status).toBe('ok');
    expect(assistant.turn.tools[0]!.resultText).toBe('file body');
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(1);
  });

  it('restores the items the message projection dropped', () => {
    const msgs = threadToMsgs(
      turn([
        { type: 'approval', payload: { toolName: 'Edit', decision: 'allow' } },
        { type: 'ask_user', payload: { question: 'Which one?', answer: 'the first' } },
        {
          type: 'review_finding',
          payload: { path: 'src/a.ts', startLine: 4, title: 'Null crash' },
        },
        { type: 'review_action', payload: { kind: 'apply', findingIds: ['f1'] } },
        { type: 'error', payload: { message: 'provider timed out' } },
      ]),
    );
    const text = msgs.map((m) => (m.role === 'system' ? m.text : '')).join('\n');
    expect(text).toContain('Edit');
    expect(text).toContain('allow');
    expect(text).toContain('Which one?');
    expect(text).toContain('the first');
    expect(text).toContain('src/a.ts:4');
    expect(text).toContain('Null crash');
    expect(text).toContain('review apply');
    expect(text).toContain('provider timed out');
    expect(msgs.at(-1)).toMatchObject({ level: 'error' });
  });

  it('keeps items in the order they completed', () => {
    const msgs = threadToMsgs(
      turn([
        { type: 'user_message', payload: { text: 'first' } },
        { type: 'ask_user', payload: { question: 'q', answer: 'a' } },
        { type: 'user_message', payload: { text: 'second' } },
      ]),
    );
    expect(msgs.map((m) => m.role)).toEqual(['user', 'system', 'user']);
  });

  it('ignores item types it does not know', () => {
    expect(threadToMsgs(turn([{ type: 'something_new', payload: {} }]))).toEqual([]);
  });

  it('returns nothing for a thread with no turns', () => {
    expect(threadToMsgs({ turns: [] })).toEqual([]);
  });

  it('marks missing results in a protocol snapshot as unknown while retaining its error', () => {
    const msgs = threadToMsgs(
      turn([
        {
          type: 'assistant_message',
          payload: {
            message: {
              role: 'assistant',
              content: [{ type: 'tool_use', id: 'lost', name: 'Write', input: {} }],
            },
          },
        },
        { type: 'error', payload: { message: 'Connection lost before result' } },
      ]),
    );
    expect((msgs[0] as AssistantMsg).turn.tools[0]?.status).toBe('unknown');
    expect(msgs[1]).toMatchObject({
      role: 'system',
      level: 'error',
      text: 'Connection lost before result',
    });
    expect(streamingTurns(msgs)).toBe(0);
  });
});

describe('threadReviewItems', () => {
  it('collects findings and actions across turns', () => {
    const { findings, actions } = threadReviewItems({
      turns: [
        { items: [{ type: 'review_finding', payload: { findingId: 'f1' } }] },
        {
          items: [
            { type: 'review_action', payload: { actionId: 'a1', kind: 'apply' } },
            { type: 'user_message', payload: { text: 'ignored' } },
          ],
        },
      ],
    });
    expect(findings).toEqual([{ findingId: 'f1' }]);
    expect(actions).toEqual([{ actionId: 'a1', kind: 'apply' }]);
  });
});

describe('appendReasoningDelta', () => {
  it('opens a turn when reasoning arrives before any answer text', () => {
    const msgs = appendReasoningDelta([], 'first thought');
    expect(msgs).toHaveLength(1);
    const a = msgs[0] as AssistantMsg;
    expect(a.turn.reasoning).toBe('first thought');
    expect(a.turn.text).toBe('');
    expect(a.turn.streaming).toBe(true);
  });

  it('accumulates into the open turn without touching the answer', () => {
    let msgs = appendReasoningDelta([], 'a');
    msgs = appendReasoningDelta(msgs, 'b');
    msgs = appendTextDelta(msgs, 'answer');
    const a = msgs[0] as AssistantMsg;
    expect(a.turn.reasoning).toBe('ab');
    expect(a.turn.text).toBe('answer');
    expect(msgs).toHaveLength(1);
  });

  it('starts a new turn when the previous one has finished', () => {
    let msgs = appendTextDelta([], 'done');
    msgs = finalizeStreaming(msgs);
    msgs = appendReasoningDelta(msgs, 'next turn thinking');
    expect(msgs).toHaveLength(2);
    expect((msgs[1] as AssistantMsg).turn.reasoning).toBe('next turn thinking');
  });

  it('does not leak reasoning into the answer text', () => {
    const msgs = appendTextDelta(appendReasoningDelta([], 'secret plan'), 'visible');
    expect((msgs[0] as AssistantMsg).turn.text).toBe('visible');
  });

  it('puts the next step reasoning after the previous tool rather than before its card', () => {
    let msgs = appendReasoningDelta([], 'first thought');
    msgs = appendToolUse(msgs, tool('read', 'Read'));
    msgs = appendReasoningDelta(msgs, 'reasoning after read');
    msgs = appendTextDelta(msgs, 'answer after read');
    expect(msgs).toMatchObject([
      {
        role: 'assistant',
        turn: {
          reasoning: 'first thought',
          streaming: false,
          tools: [{ toolId: 'read', status: 'running' }],
        },
      },
      {
        role: 'assistant',
        turn: {
          reasoning: 'reasoning after read',
          text: 'answer after read',
          tools: [],
          streaming: true,
        },
      },
    ]);
    expect(streamingTurns(msgs)).toBe(1);
  });
});
