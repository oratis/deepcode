import { describe, expect, it, vi } from 'vitest';
import {
  applyWithCeremony,
  renderApplyPresentation,
  type ApplyPlan,
  type ApplyPresentation,
} from './apply-ceremony.js';

function plan(overrides: Partial<ApplyPlan<string>> = {}): ApplyPlan<string> {
  return {
    title: 'Apply the thing',
    explanation: {
      source: 'somewhere',
      method: 'compared hashes',
      application: 'overwrite the file',
      rollback: 'git checkout',
    },
    preview: ['restore a.ts'],
    warnings: [],
    apply: async () => 'applied',
    ...overrides,
  };
}

describe('applyWithCeremony', () => {
  it('applies only after an explicit accept', async () => {
    const apply = vi.fn(async () => 'done');
    const outcome = await applyWithCeremony(plan({ apply }), async () => 'accept');
    expect(outcome.status).toBe('applied');
    expect(outcome.result).toBe('done');
    expect(apply).toHaveBeenCalledOnce();
  });

  it('does not apply on reject, and reject is not a failure', async () => {
    // Selfware §6.3: after a reject the current version must still work, so
    // this is an ordinary outcome rather than an error.
    const apply = vi.fn(async () => 'done');
    const outcome = await applyWithCeremony(plan({ apply }), async () => 'reject');
    expect(outcome.status).toBe('rejected');
    expect(apply).not.toHaveBeenCalled();
  });

  it('does not apply on defer', async () => {
    const apply = vi.fn(async () => 'done');
    const outcome = await applyWithCeremony(plan({ apply }), async () => 'defer');
    expect(outcome.status).toBe('deferred');
    expect(apply).not.toHaveBeenCalled();
  });

  it('shows the explanation, preview and warnings before asking', async () => {
    let seen: ApplyPresentation | undefined;
    await applyWithCeremony(plan({ warnings: ['data will be lost'] }), async (p) => {
      seen = p;
      return 'reject';
    });
    expect(seen?.explanation.source).toBe('somewhere');
    expect(seen?.preview).toEqual(['restore a.ts']);
    expect(seen?.warnings).toEqual(['data will be lost']);
  });

  it('takes the rollback point before applying, not after', async () => {
    const order: string[] = [];
    const outcome = await applyWithCeremony(
      plan({
        createRollbackPoint: async () => {
          order.push('checkpoint');
          return 'ref-1';
        },
        apply: async () => {
          order.push('apply');
          return 'done';
        },
      }),
      async () => 'accept',
    );
    expect(order).toEqual(['checkpoint', 'apply']);
    expect(outcome.rollbackPoint).toBe('ref-1');
  });

  it('refuses to apply when the rollback point cannot be created', async () => {
    // The user accepted an operation described as reversible. Doing it
    // irreversibly is a different operation than the one they agreed to.
    const apply = vi.fn(async () => 'done');
    const outcome = await applyWithCeremony(
      plan({
        apply,
        createRollbackPoint: async () => {
          throw new Error('disk full');
        },
      }),
      async () => 'accept',
    );
    expect(outcome.status).toBe('failed');
    expect(apply).not.toHaveBeenCalled();
    expect(outcome.error?.message).toContain('nothing was applied');
  });

  it('reports a failing apply without throwing', async () => {
    const outcome = await applyWithCeremony(
      plan({
        apply: async () => {
          throw new Error('boom');
        },
      }),
      async () => 'accept',
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.error?.message).toBe('boom');
  });

  it('asks exactly once', async () => {
    const confirm = vi.fn(async () => 'accept' as const);
    await applyWithCeremony(plan(), confirm);
    expect(confirm).toHaveBeenCalledOnce();
  });
});

describe('renderApplyPresentation', () => {
  it('includes all four explanation fields', async () => {
    const text = renderApplyPresentation({
      title: 'Roll back chg-1',
      explanation: {
        source: 'ledger record chg-1',
        method: 'snapshot comparison',
        application: 'overwrite a.ts',
        rollback: 'recorded in the governance ledger',
      },
      preview: ['restore a.ts'],
      warnings: ['1 later change will be discarded'],
    });
    expect(text).toContain('ledger record chg-1');
    expect(text).toContain('snapshot comparison');
    expect(text).toContain('overwrite a.ts');
    expect(text).toContain('governance ledger');
    expect(text).toContain('! 1 later change will be discarded');
  });

  it('omits empty sections rather than printing empty headings', () => {
    const text = renderApplyPresentation({
      title: 'x',
      explanation: { source: 's', method: 'm', application: 'a', rollback: 'r' },
      preview: [],
      warnings: [],
    });
    expect(text).not.toContain('Warnings:');
    expect(text).not.toContain('Changes:');
  });
});
