// SessionSearch / SessionRead — let the agent consult its own past sessions.
// Spec: docs/DSH_ADOPTION_PLAN.md §1.5
//
// Neither tool takes a scope argument. Widening a search past the current
// workspace is a privacy decision, and it belongs to the user through settings
// — a scope parameter would let the model consent on the user's behalf.

import { defaultSessionsDir, readSessionRecords } from '../sessions/storage.js';
import { inWorkspace, searchSessions } from '../sessions/search.js';
import type { StoredMessage, ToolContext, ToolHandler, ToolResult } from '../types.js';

const MAX_LIMIT = 50;
const DEFAULT_READ_LIMIT = 20;

function root(ctx: ToolContext): string {
  return ctx.sessionsRoot ?? defaultSessionsDir();
}

function flatten(message: StoredMessage): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (typeof block === 'string') parts.push(block);
    else if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'tool_use') parts.push(`[calls ${block.name}]`);
    else if (block.type === 'tool_result')
      parts.push(`[result] ${block.content.slice(0, 400)}${block.content.length > 400 ? '…' : ''}`);
  }
  return parts.join('\n');
}

export const SessionSearchTool: ToolHandler = {
  name: 'SessionSearch',
  definition: {
    name: 'SessionSearch',
    description:
      'Searches your own past sessions in this workspace for text, newest first. Use it when the user refers to earlier work ("like we did last time", "the fix from last week") or when a problem feels previously solved. Returns excerpts with a session id; read the surrounding conversation with SessionRead.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to look for (case-insensitive).' },
        limit: { type: 'number', description: `Max results (default 20, max ${MAX_LIMIT}).` },
      },
      required: ['query'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const query = rawInput['query'];
    if (typeof query !== 'string' || query.trim().length === 0) {
      return { content: 'Error: query is required (non-empty string).', isError: true };
    }
    const requested = rawInput['limit'];
    const limit =
      typeof requested === 'number' && requested > 0 ? Math.min(requested, MAX_LIMIT) : undefined;

    const result = await searchSessions({
      root: root(ctx),
      query,
      cwd: ctx.cwd,
      ...(ctx.sessionSearchScope !== undefined ? { scope: ctx.sessionSearchScope } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(ctx.sessionId !== undefined ? { excludeSessionId: ctx.sessionId } : {}),
    });

    if (result.hits.length === 0) {
      const where =
        ctx.sessionSearchScope === 'all' ? 'any session' : 'past sessions for this workspace';
      return {
        content: `No matches for "${query}" in ${where} (${result.sessionsSearched} searched).`,
        data: { hits: 0, sessionsSearched: result.sessionsSearched },
      };
    }

    const lines = result.hits.map(
      (h) =>
        `${h.sessionId}#${h.messageIndex} [${h.role}${h.timestamp ? ` ${h.timestamp}` : ''}]${h.title ? ` — ${h.title}` : ''}\n  ${h.excerpt}`,
    );
    const note = result.truncated ? `\n\n[stopped at ${result.hits.length} results]` : '';
    return {
      content: `${result.hits.length} match(es) across ${result.sessionsSearched} session(s):\n\n${lines.join('\n\n')}${note}\n\nRead around a hit with SessionRead({ session_id, offset }).`,
      data: { hits: result.hits.length, sessionsSearched: result.sessionsSearched },
    };
  },
};

export const SessionReadTool: ToolHandler = {
  name: 'SessionRead',
  definition: {
    name: 'SessionRead',
    description:
      'Reads messages from one of your past sessions, for following up a SessionSearch hit. Use the offset from the hit (the number after #) to land on it.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session id, as returned by SessionSearch.' },
        offset: { type: 'number', description: '0-indexed message to start at (default 0).' },
        limit: { type: 'number', description: 'Messages to return (default 20).' },
      },
      required: ['session_id'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const sessionId = rawInput['session_id'];
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return { content: 'Error: session_id is required (string).', isError: true };
    }

    const sessionsRoot = root(ctx);
    let read;
    try {
      read = await readSessionRecords(sessionsRoot, sessionId);
    } catch (err) {
      return {
        content: `Error reading session ${sessionId}: ${(err as Error).message}`,
        isError: true,
      };
    }
    if (read.format === 'empty') {
      return { content: `Error: no session ${sessionId} under ${sessionsRoot}.`, isError: true };
    }

    // The same scope rule as search: knowing an id is not authorization to read
    // a session from another workspace.
    const scope = ctx.sessionSearchScope ?? 'workspace';
    if (scope !== 'all' && read.meta && !inWorkspace(read.meta.cwd, ctx.cwd)) {
      return {
        content: `Error: session ${sessionId} belongs to another workspace (${read.meta.cwd}). Searching outside this workspace is off unless the user enables it.`,
        isError: true,
      };
    }

    const rawOffset = rawInput['offset'];
    const offset = typeof rawOffset === 'number' && rawOffset > 0 ? Math.floor(rawOffset) : 0;
    const rawLimit = rawInput['limit'];
    const limit =
      typeof rawLimit === 'number' && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
        : DEFAULT_READ_LIMIT;

    const slice = read.messages.slice(offset, offset + limit);
    if (slice.length === 0) {
      return {
        content: `Session ${sessionId} has ${read.messages.length} message(s); offset ${offset} is past the end.`,
        data: { total: read.messages.length },
      };
    }

    const body = slice
      .map(
        (m, i) =>
          `--- #${offset + i} ${m.role}${m.timestamp ? ` ${m.timestamp}` : ''}\n${flatten(m)}`,
      )
      .join('\n\n');
    const more =
      offset + slice.length < read.messages.length
        ? `\n\n[${read.messages.length - offset - slice.length} more message(s); raise offset to continue]`
        : '';
    return {
      content: `${read.meta?.title ? `${read.meta.title}\n` : ''}${body}${more}`,
      data: { total: read.messages.length, returned: slice.length, offset },
    };
  },
};
