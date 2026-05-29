import { describe, expect, it } from 'vitest';
import {
  appendTextDelta,
  appendToolUse,
  attachToolResult,
  finalizeStreaming,
  lastAssistantIndex,
  pickTarget,
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

  it('pickTarget surfaces the most relevant field', () => {
    expect(pickTarget({ file_path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(pickTarget({ command: 'ls -la' })).toBe('ls -la');
    expect(pickTarget({ irrelevant: 1 })).toBeUndefined();
  });
});
