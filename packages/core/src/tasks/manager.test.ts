import { describe, expect, it } from 'vitest';
import { TaskManager, type TaskRunHandle } from './manager.js';

function deferred(): {
  promise: Promise<string>;
  resolve: (v: string) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: string) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TaskManager', () => {
  it('create returns a running task; wait → completed + final output', async () => {
    const d = deferred();
    const mgr = new TaskManager(() => ({ done: d.promise, abort: () => {} }));
    const t = mgr.create({ description: 'x', prompt: 'do x' });
    expect(t.status).toBe('running');
    expect(t.id).toMatch(/^task-/);

    d.resolve('the result');
    const done = await mgr.wait(t.id);
    expect(done?.status).toBe('completed');
    expect(done?.output).toBe('the result');
    expect(done?.finishedAt).toBeTruthy();
  });

  it('a failed runner marks the task failed', async () => {
    const d = deferred();
    const mgr = new TaskManager(() => ({ done: d.promise, abort: () => {} }));
    const t = mgr.create({ description: 'x', prompt: 'y' });
    d.reject(new Error('boom'));
    const done = await mgr.wait(t.id);
    expect(done?.status).toBe('failed');
    expect(done?.output).toMatch(/boom/);
  });

  it('stop aborts the run + marks stopped; second stop is a no-op', async () => {
    let aborted = false;
    const mgr = new TaskManager(
      () =>
        ({ done: new Promise<string>(() => {}), abort: () => (aborted = true) }) as TaskRunHandle,
    );
    const t = mgr.create({ description: 'x', prompt: 'y' });
    expect(mgr.stop(t.id)).toBe(true);
    expect(aborted).toBe(true);
    expect(mgr.get(t.id)?.status).toBe('stopped');
    expect(mgr.stop(t.id)).toBe(false);
  });

  it('a streaming runner accumulates output via onChunk (kept over final text)', async () => {
    const d = deferred();
    let emit!: (c: string) => void;
    const mgr = new TaskManager(() => ({
      done: d.promise,
      abort: () => {},
      onChunk: (cb) => (emit = cb),
    }));
    const t = mgr.create({ description: 'x', prompt: 'y' });
    emit('chunk1 ');
    emit('chunk2');
    expect(mgr.output(t.id)).toBe('chunk1 chunk2');
    d.resolve('final-ignored');
    await mgr.wait(t.id);
    expect(mgr.output(t.id)).toBe('chunk1 chunk2');
    expect(mgr.get(t.id)?.status).toBe('completed');
  });

  it('list / get / update / unknown-id behaviour', async () => {
    const mgr = new TaskManager(() => ({ done: Promise.resolve('r'), abort: () => {} }));
    const t = mgr.create({ description: 'orig', prompt: 'p' });
    expect(mgr.list().map((x) => x.id)).toEqual([t.id]);
    expect(mgr.update(t.id, { description: 'renamed' })).toBe(true);
    expect(mgr.get(t.id)?.description).toBe('renamed');
    expect(mgr.get('nope')).toBeUndefined();
    expect(mgr.update('nope', { description: 'x' })).toBe(false);
    expect(mgr.output('nope')).toBeUndefined();
  });
});
