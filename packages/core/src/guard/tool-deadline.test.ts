import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TOOL_DEADLINE_MS,
  deadlineMessage,
  resolveToolDeadlineMs,
} from './tool-deadline.js';

describe('resolveToolDeadlineMs', () => {
  it('applies the default when nothing is configured', () => {
    expect(resolveToolDeadlineMs('Grep', {})).toBe(DEFAULT_TOOL_DEADLINE_MS);
  });

  it('honors a per-tool override', () => {
    expect(resolveToolDeadlineMs('Grep', {}, { perTool: { Grep: 5_000 } })).toBe(5_000);
    expect(resolveToolDeadlineMs('Read', {}, { perTool: { Grep: 5_000 } })).toBe(
      DEFAULT_TOOL_DEADLINE_MS,
    );
  });

  it('returns nothing when disabled', () => {
    expect(resolveToolDeadlineMs('Bash', {}, { disabled: true })).toBeUndefined();
  });

  it('never cuts a caller-requested timeout short', () => {
    // Bash({ timeout: 900000 }) is an explicit request for a 15-minute command.
    // A backstop that killed it at 10 would make the parameter a lie.
    const ms = resolveToolDeadlineMs('Bash', { timeout: 900_000 });
    expect(ms).toBeGreaterThan(900_000);
  });

  it('leaves room for the tool to time out first', () => {
    // The inner limit firing produces the better error, so it must win the race.
    const ms = resolveToolDeadlineMs('Bash', { timeout: 900_000 }) as number;
    expect(ms - 900_000).toBeGreaterThanOrEqual(30_000);
  });

  it('keeps the backstop when the requested timeout is shorter', () => {
    expect(resolveToolDeadlineMs('Bash', { timeout: 1_000 })).toBe(DEFAULT_TOOL_DEADLINE_MS);
  });

  it('ignores an unusable timeout argument', () => {
    for (const timeout of ['soon', -5, 0, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(resolveToolDeadlineMs('Bash', { timeout })).toBe(DEFAULT_TOOL_DEADLINE_MS);
    }
  });
});

describe('deadlineMessage', () => {
  it('does not claim a side-effecting tool changed nothing', () => {
    // Abandoning the wait does not abort the work. Saying otherwise would be a
    // guess presented as a fact.
    const msg = deadlineMessage('Bash', 600_000);
    expect(msg).toContain('may still be running');
    expect(msg).toContain('unknown');
  });

  it('suggests narrowing for a read-only tool', () => {
    const msg = deadlineMessage('Grep', 600_000);
    expect(msg).toContain('Narrow the request');
    expect(msg).not.toContain('unknown');
  });

  it('states the elapsed budget in seconds', () => {
    expect(deadlineMessage('Grep', 5_000)).toContain('5s');
  });
});
