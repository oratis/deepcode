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

// The card header's label comes from core, so the CLI and the extension read
// the same answer rather than each keeping their own key list.
import { pickTarget } from '@deepcode/core/dist/tools/presentation.js';
import type { ToolLocation } from '@deepcode/core/dist/tools/presentation.js';

export { pickTarget };

export interface ToolInvocation {
  toolId: string;
  name: string;
  target?: string;
  input: Record<string, unknown>;
  status: 'running' | 'ok' | 'err';
  resultText?: string;
  /**
   * Openable places the call found, from the result's structured data. Only
   * live results carry them — a session restored from its log has just the
   * text, and its cards degrade to the plain-text body.
   */
  locations?: ToolLocation[];
}

export interface AssistantTurn {
  text: string;
  /**
   * The model's reasoning for this turn, when it produces any. Kept separate
   * from `text` so it can be rendered as a distinct, collapsible channel — it
   * is not the answer, and concatenating it into the answer is how it used to
   * get dropped instead.
   */
  reasoning?: string;
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

/**
 * Append a reasoning delta to the open assistant turn, opening one if needed.
 * Reasoning usually arrives *before* any answer text, so this has to be able to
 * start the turn on its own.
 */
export function appendReasoningDelta(msgs: Msg[], delta: string): Msg[] {
  const idx = lastAssistantIndex(msgs);
  const target = idx === -1 ? null : (msgs[idx] as AssistantMsg);
  if (target && target.turn.streaming) {
    const copy = [...msgs];
    copy[idx] = {
      role: 'assistant',
      turn: { ...target.turn, reasoning: (target.turn.reasoning ?? '') + delta },
    };
    return copy;
  }
  return [
    ...msgs,
    { role: 'assistant', turn: { text: '', reasoning: delta, tools: [], streaming: true } },
  ];
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
  locations?: ToolLocation[],
): Msg[] {
  let messageIndex = -1;
  let toolIndex = -1;

  // Prefer an exact id, newest first. If a legacy provider omitted/mutated the
  // id, fall back once to the globally newest running tool — never once per
  // assistant message, which would rewrite unrelated resumed history.
  for (let i = msgs.length - 1; i >= 0 && toolIndex === -1; i--) {
    const message = msgs[i]!;
    if (message.role !== 'assistant') continue;
    const candidate = lastToolIndex(message.turn.tools, (tool) => tool.toolId === toolId);
    if (candidate !== -1) {
      messageIndex = i;
      toolIndex = candidate;
    }
  }
  for (let i = msgs.length - 1; i >= 0 && toolIndex === -1; i--) {
    const message = msgs[i]!;
    if (message.role !== 'assistant') continue;
    const candidate = lastToolIndex(message.turn.tools, (tool) => tool.status === 'running');
    if (candidate !== -1) {
      messageIndex = i;
      toolIndex = candidate;
    }
  }
  if (messageIndex === -1 || toolIndex === -1) return msgs;

  return msgs.map((message, index): Msg => {
    if (index !== messageIndex || message.role !== 'assistant') return message;
    const tools = [...message.turn.tools];
    tools[toolIndex] = {
      ...tools[toolIndex]!,
      status,
      resultText: content,
      ...(locations && locations.length > 0 ? { locations } : {}),
    };
    return { ...message, turn: { ...message.turn, tools } };
  });
}

function lastToolIndex(
  tools: ToolInvocation[],
  predicate: (tool: ToolInvocation) => boolean,
): number {
  for (let i = tools.length - 1; i >= 0; i--) {
    if (predicate(tools[i]!)) return i;
  }
  return -1;
}

/** Clear the streaming flag on ALL assistant turns (not just the last one). */
export function finalizeStreaming(msgs: Msg[]): Msg[] {
  return msgs.map((m): Msg =>
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
  return stored.reduce(appendStoredLine, [] as Msg[]);
}

/**
 * Fold one stored message into the transcript.
 *
 * Split out of storedToMsgs so a thread projection can interleave non-message
 * items without losing tool-result attachment: a `tool_result` block has to be
 * matched against the assistant turn already in `msgs`, which a fresh
 * storedToMsgs([line]) call cannot see.
 */
export function appendStoredLine(input: Msg[], m: StoredLine): Msg[] {
  let msgs = [...input];
  {
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

// ── Resuming from a protocol thread ──────────────────────────────────────

/** The subset of a protocol CompletedItem this projection needs. */
export interface ThreadItem {
  type: string;
  payload: Record<string, unknown>;
}
export interface ThreadTurn {
  items: ThreadItem[];
}
export interface ThreadLike {
  turns: ThreadTurn[];
}

/**
 * Rebuild the transcript from a protocol thread snapshot.
 *
 * The session projection the desktop used to resume from keeps only the items
 * that carry a StoredMessage, so approvals, ask-user exchanges, errors and
 * review findings were persisted in the snapshot and then never shown again.
 * This reads the snapshot itself, so a resumed conversation looks like the one
 * that was interrupted.
 */
export function threadToMsgs(thread: ThreadLike): Msg[] {
  let msgs: Msg[] = [];
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      switch (item.type) {
        case 'user_message':
          if (str(item.payload.text)) msgs.push({ role: 'user', text: str(item.payload.text) });
          break;

        case 'assistant_message':
        case 'tool_result': {
          const message = item.payload.message as StoredLine | undefined;
          if (Array.isArray(message?.content)) msgs = appendStoredLine(msgs, message);
          break;
        }

        case 'approval': {
          const tool = str(item.payload.toolName) || 'tool';
          const decision = str(item.payload.decision) || 'answered';
          msgs.push({ role: 'system', text: `⏸ ${tool} — ${decision}` });
          break;
        }

        case 'ask_user': {
          const question = str(item.payload.question);
          const answer = str(item.payload.answer);
          msgs.push({ role: 'system', text: `❯ ${question}${answer ? ` → ${answer}` : ''}` });
          break;
        }

        case 'review_finding':
          msgs.push({
            role: 'system',
            text: `⚑ ${str(item.payload.path)}${
              typeof item.payload.startLine === 'number' ? `:${item.payload.startLine}` : ''
            } — ${str(item.payload.title)}`,
          });
          break;

        case 'review_action':
          msgs.push({
            role: 'system',
            text: `${str(item.payload.kind) === 'revert' ? '↩' : '✎'} review ${str(
              item.payload.kind,
            )} · ${(item.payload.findingIds as string[] | undefined)?.length ?? 0} finding(s)`,
          });
          break;

        case 'error':
          msgs.push({
            role: 'system',
            text: str(item.payload.message) || 'Turn failed.',
            level: 'error',
          });
          break;
      }
    }
  }
  return msgs;
}

/** Review findings and actions carried by a resumed thread, for the Changes panel. */
export function threadReviewItems(thread: ThreadLike): {
  findings: Record<string, unknown>[];
  actions: Record<string, unknown>[];
} {
  const findings: Record<string, unknown>[] = [];
  const actions: Record<string, unknown>[] = [];
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type === 'review_finding') findings.push(item.payload);
      else if (item.type === 'review_action') actions.push(item.payload);
    }
  }
  return { findings, actions };
}
