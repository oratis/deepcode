// Pure stream-reducer helpers for the REPL chat view.
//
// Extracted from Repl.tsx so the streaming state machine can be unit-tested
// without a DOM. These functions take the current message list + an incoming
// event and return a new list — no React, no side effects.
//
// Invariant they enforce: at most ONE assistant turn is ever `streaming`. A
// system breadcrumb (e.g. the "added to permissions.allow" note) pushed between
// streaming deltas must NOT orphan the open assistant turn or spawn a second
// streaming bubble — that was the "two blinking cursors" bug.

export interface ToolInvocation {
  toolId: string;
  name: string;
  target?: string;
  input: Record<string, unknown>;
  status: 'running' | 'ok' | 'err';
  resultText?: string;
}

export interface AssistantTurn {
  text: string;
  /** Tool calls interleaved during this turn — rendered as cards after the text. */
  tools: ToolInvocation[];
  streaming: boolean;
}

export interface UserMsg {
  role: 'user';
  text: string;
}
export interface AssistantMsg {
  role: 'assistant';
  turn: AssistantTurn;
}
export interface SystemMsg {
  role: 'system';
  text: string;
  level?: 'info' | 'error';
}
export type Msg = UserMsg | AssistantMsg | SystemMsg;

/** Index of the last assistant message, or -1. Skips trailing system/user msgs. */
export function lastAssistantIndex(msgs: Msg[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.role === 'assistant') return i;
  }
  return -1;
}

/**
 * Append a text delta to the open (streaming) assistant turn. Crucially this
 * targets the last *assistant* message even when a system note sits after it —
 * so a mid-stream breadcrumb can't split one response into two cursors.
 */
export function appendTextDelta(msgs: Msg[], delta: string): Msg[] {
  const idx = lastAssistantIndex(msgs);
  const target = idx === -1 ? null : (msgs[idx] as AssistantMsg);
  if (target && target.turn.streaming) {
    const copy = [...msgs];
    copy[idx] = { role: 'assistant', turn: { ...target.turn, text: target.turn.text + delta } };
    return copy;
  }
  return [...msgs, { role: 'assistant', turn: { text: delta, tools: [], streaming: true } }];
}

/** Append a tool invocation to the open assistant turn (same anti-split rule). */
export function appendToolUse(msgs: Msg[], tool: ToolInvocation): Msg[] {
  const idx = lastAssistantIndex(msgs);
  const target = idx === -1 ? null : (msgs[idx] as AssistantMsg);
  if (target && target.turn.streaming) {
    const copy = [...msgs];
    copy[idx] = {
      role: 'assistant',
      turn: { ...target.turn, tools: [...target.turn.tools, tool] },
    };
    return copy;
  }
  return [...msgs, { role: 'assistant', turn: { text: '', tools: [tool], streaming: true } }];
}

/**
 * Attach a tool result to the matching card by id. Falls back to the last
 * still-running card only when the id isn't found (defensive — ids should match).
 */
export function attachToolResult(
  msgs: Msg[],
  toolId: string,
  content: string,
  status: 'ok' | 'err',
): Msg[] {
  return msgs.map((m): Msg => {
    if (m.role !== 'assistant') return m;
    let idx = m.turn.tools.findIndex((t) => t.toolId === toolId);
    if (idx === -1) {
      for (let j = m.turn.tools.length - 1; j >= 0; j--) {
        if (m.turn.tools[j]!.status === 'running') {
          idx = j;
          break;
        }
      }
    }
    if (idx === -1) return m;
    const tools = [...m.turn.tools];
    tools[idx] = { ...tools[idx]!, status, resultText: content };
    return { ...m, turn: { ...m.turn, tools } };
  });
}

/** Clear the streaming flag on ALL assistant turns (not just the last one). */
export function finalizeStreaming(msgs: Msg[]): Msg[] {
  return msgs.map(
    (m): Msg =>
      m.role === 'assistant' && m.turn.streaming
        ? { role: 'assistant', turn: { ...m.turn, streaming: false } }
        : m,
  );
}

/** A stored message line (role + content blocks) as persisted to a session. */
export interface StoredLine {
  role: 'user' | 'assistant';
  content: Array<Record<string, unknown>>;
}

/**
 * Reconstruct the chat view (Msg[]) from a session's stored messages, so picking
 * a past session re-renders its conversation. Mirrors the live stream reducers
 * in batch: assistant text + tool_use become a turn; the following user message's
 * tool_result blocks attach to those cards by tool_use_id. Thinking blocks are
 * dropped (they were streaming-only). All turns are non-streaming (finalized).
 */
export function storedToMsgs(stored: StoredLine[]): Msg[] {
  let msgs: Msg[] = [];
  for (const m of stored) {
    if (m.role === 'assistant') {
      const texts: string[] = [];
      const tools: ToolInvocation[] = [];
      for (const b of m.content) {
        if (b.type === 'text' && typeof b.text === 'string') {
          texts.push(b.text);
        } else if (b.type === 'tool_use') {
          const input = (b.input as Record<string, unknown>) ?? {};
          tools.push({
            toolId: String(b.id ?? ''),
            name: String(b.name ?? '?'),
            input,
            target: pickTarget(input),
            status: 'running',
          });
        }
      }
      msgs.push({ role: 'assistant', turn: { text: texts.join('\n'), tools, streaming: false } });
    } else {
      const texts: string[] = [];
      for (const b of m.content) {
        if (b.type === 'text' && typeof b.text === 'string') {
          texts.push(b.text);
        } else if (b.type === 'tool_result') {
          const id = String(b.tool_use_id ?? '');
          const content = typeof b.content === 'string' ? b.content : '';
          msgs = attachToolResult(msgs, id, content, b.is_error ? 'err' : 'ok');
        }
      }
      if (texts.length > 0) msgs.push({ role: 'user', text: texts.join('\n') });
    }
  }
  return msgs;
}

/** Pick a human-readable target from a tool's input for the card header. */
export function pickTarget(input: Record<string, unknown>): string | undefined {
  for (const k of ['file_path', 'command', 'pattern', 'path', 'url', 'query']) {
    const v = input[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}
