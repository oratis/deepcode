import { describe, expect, it, vi } from 'vitest';
import { Context, createKernel, KernelSlot, type KernelPlugin } from './index.js';

const provider = (value: number): KernelPlugin => ({
  id: 'provider',
  provides: ['answer'],
  apply(ctx) {
    ctx.provide('answer', value);
  },
});

describe('actual Cordis 4.1.0 adapter', () => {
  it('injects services and awaits reverse async disposal including child scopes', async () => {
    const seen: string[] = [];
    const kernel = await createKernel([
      {
        id: 'consumer',
        requires: ['answer'],
        async apply(ctx) {
          expect(ctx.get('answer')).toBe(42);
          await ctx.plugin({
            name: 'child',
            apply(child) {
              child.effect(() => async () => {
                await Promise.resolve();
                seen.push('child');
              });
            },
          });
          ctx.effect(() => async () => {
            await Promise.resolve();
            seen.push('consumer');
          });
        },
      },
      {
        ...provider(42),
        apply(ctx) {
          ctx.provide('answer', 42);
          ctx.effect(() => () => {
            seen.push('provider');
          });
        },
      },
    ]);
    expect(Context.is(kernel.context)).toBe(true);
    expect(kernel.plugins).toEqual(['provider', 'consumer']);
    await kernel.close();
    await kernel.close();
    expect(seen).toEqual(['consumer', 'child', 'provider']);
    expect(kernel.context.get('answer')).toBeUndefined();
    expect(kernel.context.registry.size).toBe(0);
  });
  it.each(['missing', 'cycle', 'duplicate-service', 'duplicate-id'])(
    'rejects %s before any effects',
    async (kind) => {
      const apply = vi.fn();
      const graph: KernelPlugin[] =
        kind === 'missing'
          ? [{ id: 'a', requires: ['missing'], apply }]
          : kind === 'cycle'
            ? [
                { id: 'a', provides: ['a'], requires: ['b'], apply },
                { id: 'b', provides: ['b'], requires: ['a'], apply },
              ]
            : kind === 'duplicate-service'
              ? [
                  { id: 'a', provides: ['x'], apply },
                  { id: 'b', provides: ['x'], apply },
                ]
              : [
                  { id: 'a', apply },
                  { id: 'a', apply },
                ];
      await expect(createKernel(graph)).rejects.toThrow();
      expect(apply).not.toHaveBeenCalled();
    },
  );
  it('rolls back acquired effects on failed activation or missing declared provision', async () => {
    const dispose = vi.fn();
    await expect(
      createKernel([
        {
          id: 'fails',
          apply(ctx) {
            ctx.effect(() => dispose);
            throw new Error('activation failed');
          },
        },
      ]),
    ).rejects.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
    await expect(createKernel([{ id: 'liar', provides: ['absent'], apply() {} }])).rejects.toThrow(
      /did not provide/,
    );
  });
  it('surfaces teardown errors that Cordis logs instead of throwing', async () => {
    const kernel = await createKernel([
      {
        id: 'failure',
        apply(ctx) {
          ctx.effect(() => () => {
            throw new Error('teardown failed');
          });
        },
      },
    ]);
    await expect(kernel.close()).rejects.toThrow(/lifecycle failed/);
    expect(kernel.context.registry.size).toBe(0);
  });
  it('retains active graph on candidate failure and fully releases each successful reload', async () => {
    const slot = new KernelSlot();
    await slot.reload([provider(1)]);
    const first = slot.active!;
    await expect(
      slot.reload([
        {
          id: 'broken',
          apply() {
            throw new Error('bad');
          },
        },
      ]),
    ).rejects.toThrow();
    expect(slot.active).toBe(first);
    expect(first.context.get('answer')).toBe(1);
    for (let n = 2; n <= 20; n++) {
      const previous = slot.active!;
      await slot.reload([provider(n)]);
      expect(previous.context.registry.size).toBe(0);
      expect(previous.context.get('answer')).toBeUndefined();
      expect(slot.active!.context.get('answer')).toBe(n);
    }
    await slot.close();
    await slot.close();
    await expect(slot.reload([provider(99)])).rejects.toThrow(/closed/);
  });
  it('Cordis isolation does not fall through to the parent service', async () => {
    const kernel = await createKernel([provider(1)]);
    const isolated = kernel.context.isolate('answer');
    expect(isolated.get('answer')).toBeUndefined();
    const child = await isolated.plugin({
      apply(ctx) {
        ctx.provide('answer', 2);
      },
    });
    expect(isolated.get('answer')).toBe(2);
    expect(kernel.context.get('answer')).toBe(1);
    await child.dispose();
    expect(isolated.get('answer')).toBeUndefined();
    await kernel.close();
  });
});
