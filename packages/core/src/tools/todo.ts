// TodoWrite tool — agent-managed task list, persisted per-session.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 / behavior parity with Claude Code's TodoWrite.
//
// The list lives in `<sessionDir>/todos.json`. Each call replaces the whole list
// (agent submits the desired state). UI can render it as a checklist. The tool
// itself is stateless — state is the file.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  /** First-person continuous form, shown while the item is in_progress. */
  activeForm: string;
  status: TodoStatus;
}

interface TodoInput {
  todos: TodoItem[];
}

/** Where the per-session todo list lives — relative to sessionDir. */
export const TODO_FILE = 'todos.json';

function isTodo(x: unknown): x is TodoItem {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o['content'] === 'string' &&
    typeof o['activeForm'] === 'string' &&
    (o['status'] === 'pending' || o['status'] === 'in_progress' || o['status'] === 'completed')
  );
}

export const TodoWriteTool: ToolHandler = {
  name: 'TodoWrite',
  definition: {
    name: 'TodoWrite',
    description:
      'Replace the session todo list. Submit the full desired state (not a diff). Each item has content (imperative), activeForm (first-person continuous, shown while in_progress), and status (pending|in_progress|completed). Convention: at most ONE item in_progress at a time.',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'Full list of todo items in the desired final state.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Imperative task description.' },
              activeForm: { type: 'string', description: 'First-person continuous form.' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['content', 'activeForm', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as TodoInput;
    if (!Array.isArray(input?.todos)) {
      return { content: 'Error: todos must be an array.', isError: true };
    }
    if (!input.todos.every(isTodo)) {
      return {
        content:
          'Error: each todo needs string content, string activeForm, and status in (pending|in_progress|completed).',
        isError: true,
      };
    }
    const inProgressCount = input.todos.filter((t) => t.status === 'in_progress').length;
    if (inProgressCount > 1) {
      return {
        content: `Error: at most one todo may be in_progress at a time (got ${inProgressCount}).`,
        isError: true,
      };
    }

    if (!ctx.sessionDir) {
      // Without a sessionDir we can't persist, but we still validate and return.
      return {
        content: `OK (not persisted: no sessionDir). ${summarize(input.todos)}`,
        data: { todos: input.todos, persisted: false },
      };
    }

    const target = join(ctx.sessionDir, TODO_FILE);
    try {
      await fs.mkdir(ctx.sessionDir, { recursive: true });
      await fs.writeFile(target, JSON.stringify(input.todos, null, 2) + '\n', 'utf8');
    } catch (err) {
      return {
        content: `Error persisting todos: ${(err as Error).message}`,
        isError: true,
      };
    }

    return {
      content: `OK. ${summarize(input.todos)}`,
      data: { todos: input.todos, persisted: true, path: target },
    };
  },
};

function summarize(todos: TodoItem[]): string {
  const counts = { pending: 0, in_progress: 0, completed: 0 };
  for (const t of todos) counts[t.status]++;
  return `${todos.length} todos (${counts.completed} done · ${counts.in_progress} in_progress · ${counts.pending} pending).`;
}

/** Reads the current todo list from a session dir. Returns [] if none. */
export async function readTodos(sessionDir: string): Promise<TodoItem[]> {
  try {
    const raw = await fs.readFile(join(sessionDir, TODO_FILE), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every(isTodo)) return parsed;
    return [];
  } catch {
    return [];
  }
}
