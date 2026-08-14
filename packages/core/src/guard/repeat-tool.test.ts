import { describe, it, expect } from 'vitest';
import { RepeatToolGuard } from './repeat-tool.js';

/** Call the guard n times with the same arguments; return every reminder fired. */
function run(guard: RepeatToolGuard, tool: string, input: Record<string, unknown>, times: number) {
  const fired = [];
  for (let i = 0; i < times; i++) {
    const r = guard.observe(tool, input);
    if (r) fired.push(r);
  }
  return fired;
}

describe('RepeatToolGuard', () => {
  it('stays quiet below the first threshold', () => {
    const guard = new RepeatToolGuard();
    expect(run(guard, 'Grep', { pattern: 'x' }, 2)).toHaveLength(0);
  });

  it('fires at each configured threshold and nowhere else', () => {
    const guard = new RepeatToolGuard();
    const fired = run(guard, 'Grep', { pattern: 'x' }, 10);
    expect(fired.map((r) => r.runLength)).toEqual([3, 5, 8]);
  });

  it('escalates from a brief nudge to a detailed one', () => {
    const guard = new RepeatToolGuard();
    const fired = run(guard, 'Grep', { pattern: 'x' }, 6);
    expect(fired.map((r) => r.kind)).toEqual(['brief', 'detailed']);
    expect(fired[0].text).not.toContain('"pattern"');
    expect(fired[1].text).toContain('"pattern":"x"');
  });

  it('treats argument order as irrelevant', () => {
    const guard = new RepeatToolGuard();
    guard.observe('Grep', { a: 1, b: 2 });
    guard.observe('Grep', { b: 2, a: 1 });
    const r = guard.observe('Grep', { a: 1, b: 2 });
    expect(r?.runLength).toBe(3);
  });

  it('resets when the arguments change', () => {
    const guard = new RepeatToolGuard();
    run(guard, 'Grep', { pattern: 'x' }, 2);
    expect(guard.observe('Grep', { pattern: 'y' })).toBeNull();
    expect(guard.observe('Grep', { pattern: 'y' })).toBeNull();
    expect(guard.observe('Grep', { pattern: 'y' })?.runLength).toBe(3);
  });

  it('resets when a different tool is called', () => {
    const guard = new RepeatToolGuard();
    run(guard, 'Grep', { pattern: 'x' }, 2);
    guard.observe('Read', { file_path: 'a' });
    expect(guard.observe('Grep', { pattern: 'x' })).toBeNull();
  });

  it('does not let an excluded tool launder a loop', () => {
    // The point of exclusion: bookkeeping interleaved into a loop is still a loop.
    const guard = new RepeatToolGuard();
    guard.observe('Grep', { pattern: 'x' });
    guard.observe('TodoWrite', { todos: [] });
    guard.observe('Grep', { pattern: 'x' });
    guard.observe('TodoWrite', { todos: [] });
    expect(guard.observe('Grep', { pattern: 'x' })?.runLength).toBe(3);
  });

  it('never reports on an excluded tool itself', () => {
    const guard = new RepeatToolGuard();
    expect(run(guard, 'TodoWrite', { todos: [] }, 20)).toHaveLength(0);
  });

  it('supports wildcard exclusions', () => {
    const guard = new RepeatToolGuard({ exclude: ['mcp__*'] });
    expect(run(guard, 'mcp__db__query', { q: 1 }, 10)).toHaveLength(0);
    expect(run(guard, 'Grep', { pattern: 'x' }, 3)).toHaveLength(1);
  });

  it('caps the arguments it quotes back', () => {
    // Only the detailed form quotes arguments, so this needs the second threshold.
    const guard = new RepeatToolGuard({ thresholds: [2, 3], argumentsPreviewChars: 50 });
    const fired = run(guard, 'Write', { content: 'z'.repeat(10_000) }, 3);
    const detailed = fired[1];
    expect(detailed.kind).toBe('detailed');
    expect(detailed.text).toContain('more characters');
    expect(detailed.text.length).toBeLessThan(600);
  });

  it('detects on the full arguments even when the preview is capped', () => {
    // The cap bounds the reminder, never the comparison — two payloads that
    // differ only past the cap must not count as the same call.
    const guard = new RepeatToolGuard({ thresholds: [2], argumentsPreviewChars: 10 });
    guard.observe('Write', { content: `${'z'.repeat(100)}A` });
    expect(guard.observe('Write', { content: `${'z'.repeat(100)}B` })).toBeNull();
  });

  it('rejects an unusable threshold list instead of falling back', () => {
    expect(() => new RepeatToolGuard({ thresholds: [] })).toThrow(/at least one/);
    expect(() => new RepeatToolGuard({ thresholds: [1] })).toThrow(/>= 2/);
    expect(() => new RepeatToolGuard({ thresholds: [2.5] })).toThrow(/integers/);
  });

  it('normalizes thresholds given out of order or duplicated', () => {
    const guard = new RepeatToolGuard({ thresholds: [5, 3, 3] });
    const fired = run(guard, 'Grep', { pattern: 'x' }, 6);
    expect(fired.map((r) => r.runLength)).toEqual([3, 5]);
    expect(fired.map((r) => r.kind)).toEqual(['brief', 'detailed']);
  });

  it('reset() clears the chain', () => {
    const guard = new RepeatToolGuard();
    run(guard, 'Grep', { pattern: 'x' }, 2);
    guard.reset();
    expect(guard.observe('Grep', { pattern: 'x' })).toBeNull();
  });
});
