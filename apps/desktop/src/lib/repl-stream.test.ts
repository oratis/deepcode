import { describe, expect, it } from 'vitest';
import {
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

  it('does NOT spawn a second cursor when a system note interleaves the stream', () => {
    // Reproduces the "two blinking cursors" bug: a breadcrumb pushed between
    // streaming deltas must not orphan the open turn or start a new one.
    let m: Msg[] = [{ role: 'user', text: 'write a game' }];
    m = appendTextDelta(m, 'Creating files');
    m = appendToolUse(m, tool('w1', 'Write'));
    // User clicks "always allow" → a system note is pushed mid-turn.
    m.push({ role: 'system', text: '✓ "Write" added to settings.permissions.allow' });
    // The model keeps streaming the next agent-loop turn.
    m = appendTextDelta(m, ' and more');
    m = appendToolUse(m, tool('w2', 'Write'));

    // Exactly one streaming assistant turn — not two.
    expect(streamingTurns(m)).toBe(1);
    const assistant = m.find((x) => x.role === 'assistant');
    expect(assistant?.role === 'assistant' && assistant.turn.text).toBe('Creating files and more');
    expect(assistant?.role === 'assistant' && assistant.turn.tools.map((t) => t.toolId)).toEqual([
      'w1',
      'w2',
    ]);
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
