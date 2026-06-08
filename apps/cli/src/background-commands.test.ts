// Tests for the background-task slash commands: /tasks and /background.
// Both drive a session-scoped TaskManager (ctx.tasks). Here it's a real
// TaskManager wired to a stub runner — no sub-agent actually runs, so the tests
// stay fast and deterministic while exercising create / list / get / output.

import { describe, expect, it } from 'vitest';
import { SessionManager, TaskManager, type TaskRunHandle } from '@deepcode/core';
import { CommandRegistry, type SessionContext } from './commands.js';

const reg = new CommandRegistry();

/** A TaskManager whose runner immediately resolves with a fixed result string. */
function stubManager(result = 'done'): TaskManager {
  return new TaskManager(
    () => ({ done: Promise.resolve(result), abort: () => {} }) as TaskRunHandle,
  );
}

function ctx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    cwd: '/tmp/x',
    model: 'deepseek-chat',
    mode: 'default',
    effort: 'medium',
    settings: {},
    creds: { apiKey: 'sk-test' },
    sessionId: 's1',
    sessions: new SessionManager({ root: '/tmp/x' }),
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 },
    ...overrides,
  };
}

describe('/background', () => {
  it('creates a task and reports its id', async () => {
    const tasks = stubManager();
    const out = (
      await reg.match('/background')!.cmd.run(['fix', 'the', 'flaky', 'test'], ctx({ tasks }))
    ).join('\n');
    expect(out).toMatch(/Started background task task-/);
    const list = tasks.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.description).toBe('fix the flaky test');
  });

  it('the `/bg` alias works', async () => {
    const tasks = stubManager();
    await reg.match('/bg')!.cmd.run(['do', 'thing'], ctx({ tasks }));
    expect(tasks.list()).toHaveLength(1);
  });

  it('shows usage when given no prompt', async () => {
    const out = (await reg.match('/background')!.cmd.run([], ctx({ tasks: stubManager() }))).join(
      '\n',
    );
    expect(out).toMatch(/Usage: \/background/);
  });

  it('is unavailable without a task manager', async () => {
    const out = (await reg.match('/background')!.cmd.run(['x'], ctx())).join('\n');
    expect(out).toMatch(/unavailable/i);
  });

  it('reports a runner failure instead of throwing', async () => {
    const tasks = new TaskManager(() => {
      throw new Error('no runner attached');
    });
    const out = (await reg.match('/background')!.cmd.run(['x'], ctx({ tasks }))).join('\n');
    expect(out).toMatch(/Could not start background task: no runner attached/);
  });
});

describe('/tasks', () => {
  it('reports an empty list', async () => {
    const out = (await reg.match('/tasks')!.cmd.run([], ctx({ tasks: stubManager() }))).join('\n');
    expect(out).toMatch(/No background tasks yet/);
  });

  it('lists started tasks with id, status, and description', async () => {
    const tasks = stubManager();
    tasks.create({ description: 'task one', prompt: 'p1' });
    tasks.create({ description: 'task two', prompt: 'p2' });
    const out = (await reg.match('/tasks')!.cmd.run([], ctx({ tasks }))).join('\n');
    expect(out).toMatch(/Background tasks \(2\)/);
    expect(out).toContain('task one');
    expect(out).toContain('task two');
    expect(out).toMatch(/\[(running|completed)\]/);
  });

  it('`/tasks <id>` shows a single task’s status and output', async () => {
    const tasks = stubManager('the background result');
    const t = tasks.create({ description: 'investigate', prompt: 'look into x' });
    await tasks.wait(t.id); // let the stub runner settle → completed + output
    const out = (await reg.match('/tasks')!.cmd.run([t.id], ctx({ tasks }))).join('\n');
    expect(out).toContain(t.id);
    expect(out).toMatch(/\[completed\]/);
    expect(out).toContain('the background result');
  });

  it('`/tasks <unknown>` reports no such task', async () => {
    const out = (
      await reg.match('/tasks')!.cmd.run(['task-nope'], ctx({ tasks: stubManager() }))
    ).join('\n');
    expect(out).toMatch(/No task "task-nope"/);
  });

  it('is unavailable without a task manager', async () => {
    const out = (await reg.match('/tasks')!.cmd.run([], ctx())).join('\n');
    expect(out).toMatch(/unavailable/i);
  });
});
