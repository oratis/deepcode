import { describe, expect, it } from 'vitest';
import { TaskManager } from '../tasks/manager.js';
import type { ToolContext } from '../types.js';
import {
  MonitorTool,
  TaskCreateTool,
  TaskListTool,
  TaskOutputTool,
  TaskStopTool,
} from './task-manage.js';

function ctxWith(manager?: TaskManager): ToolContext {
  return { cwd: '/tmp', tasks: manager };
}

describe('task tools', () => {
  it('TaskCreate starts a task and Monitor awaits its output', async () => {
    const mgr = new TaskManager((spec) => ({
      done: Promise.resolve(`did: ${spec.prompt}`),
      abort: () => {},
    }));
    const ctx = ctxWith(mgr);
    const created = await TaskCreateTool.execute({ prompt: 'analyze logs' }, ctx);
    const id = (created.data as { id: string }).id;
    expect(created.content).toMatch(/Started background task/);

    const mon = await MonitorTool.execute({ id }, ctx);
    expect(mon.isError ?? false).toBe(false);
    expect(mon.content).toContain('completed');
    expect(mon.content).toContain('did: analyze logs');
  });

  it('TaskList + TaskOutput reflect created tasks', async () => {
    const mgr = new TaskManager(() => ({ done: Promise.resolve('out'), abort: () => {} }));
    const ctx = ctxWith(mgr);
    const { data } = await TaskCreateTool.execute({ prompt: 'p', description: 'job A' }, ctx);
    const id = (data as { id: string }).id;
    await mgr.wait(id);

    const list = await TaskListTool.execute({}, ctx);
    expect(list.content).toContain('job A');
    expect(list.content).toContain('[completed]');

    const out = await TaskOutputTool.execute({ id }, ctx);
    expect(out.content).toBe('out');
  });

  it('TaskStop cancels a running task', async () => {
    const mgr = new TaskManager(() => ({ done: new Promise<string>(() => {}), abort: () => {} }));
    const ctx = ctxWith(mgr);
    const { data } = await TaskCreateTool.execute({ prompt: 'long' }, ctx);
    const id = (data as { id: string }).id;
    const stop = await TaskStopTool.execute({ id }, ctx);
    expect(stop.content).toMatch(/Stopped task/);
    expect(mgr.get(id)?.status).toBe('stopped');
  });

  it('tools error gracefully without a task manager (e.g. sub-agent)', async () => {
    const ctx = ctxWith(undefined);
    const r = await TaskCreateTool.execute({ prompt: 'x' }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/unavailable here/);
    expect((await TaskListTool.execute({}, ctx)).isError).toBe(true);
  });

  it('Monitor/TaskOutput report unknown ids', async () => {
    const ctx = ctxWith(new TaskManager(() => ({ done: Promise.resolve(''), abort: () => {} })));
    expect((await MonitorTool.execute({ id: 'nope' }, ctx)).isError).toBe(true);
    expect((await TaskOutputTool.execute({ id: 'nope' }, ctx)).isError).toBe(true);
  });
});
