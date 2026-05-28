import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTodos, TODO_FILE, TodoWriteTool } from './todo.js';

describe('TodoWriteTool', () => {
  let sessionDir: string;
  beforeEach(async () => {
    sessionDir = await mkdtemp(join(tmpdir(), 'dc-todo-'));
  });
  afterEach(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('persists a fresh list to <sessionDir>/todos.json', async () => {
    const res = await TodoWriteTool.execute(
      {
        todos: [
          { content: 'Write spec', activeForm: 'Writing spec', status: 'in_progress' },
          { content: 'Add tests', activeForm: 'Adding tests', status: 'pending' },
        ],
      },
      { cwd: process.cwd(), sessionDir },
    );
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('OK');
    expect(res.content).toContain('2 todos');
    const raw = await fs.readFile(join(sessionDir, TODO_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Array<{ content: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].content).toBe('Write spec');
  });

  it('replaces the list on subsequent calls (no append)', async () => {
    await TodoWriteTool.execute(
      {
        todos: [{ content: 'A', activeForm: 'Doing A', status: 'pending' }],
      },
      { cwd: process.cwd(), sessionDir },
    );
    await TodoWriteTool.execute(
      {
        todos: [{ content: 'B', activeForm: 'Doing B', status: 'completed' }],
      },
      { cwd: process.cwd(), sessionDir },
    );
    const todos = await readTodos(sessionDir);
    expect(todos).toHaveLength(1);
    expect(todos[0]?.content).toBe('B');
  });

  it('rejects when more than one item is in_progress', async () => {
    const res = await TodoWriteTool.execute(
      {
        todos: [
          { content: 'A', activeForm: 'Doing A', status: 'in_progress' },
          { content: 'B', activeForm: 'Doing B', status: 'in_progress' },
        ],
      },
      { cwd: process.cwd(), sessionDir },
    );
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/at most one/i);
  });

  it('rejects malformed item shape', async () => {
    const res = await TodoWriteTool.execute(
      {
        todos: [{ content: 'A', status: 'pending' }],
      },
      { cwd: process.cwd(), sessionDir },
    );
    expect(res.isError).toBe(true);
  });

  it('rejects non-array input', async () => {
    const res = await TodoWriteTool.execute(
      { todos: 'nope' as unknown as never },
      { cwd: process.cwd(), sessionDir },
    );
    expect(res.isError).toBe(true);
  });

  it('returns ok but not persisted when no sessionDir', async () => {
    const res = await TodoWriteTool.execute(
      {
        todos: [{ content: 'X', activeForm: 'X-ing', status: 'pending' }],
      },
      { cwd: process.cwd() },
    );
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/not persisted/);
    expect((res.data as { persisted: boolean }).persisted).toBe(false);
  });

  it('readTodos returns [] when file does not exist', async () => {
    const todos = await readTodos(sessionDir);
    expect(todos).toEqual([]);
  });
});
