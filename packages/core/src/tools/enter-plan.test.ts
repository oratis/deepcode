import { describe, expect, it } from 'vitest';
import { EnterPlanModeTool } from './enter-plan.js';

describe('EnterPlanModeTool', () => {
  it('flips modeSignal.enterPlanMode and echoes the reason', async () => {
    const signal: { enterPlanMode?: boolean } = {};
    const r = await EnterPlanModeTool.execute(
      { reason: 'the refactor touches many files' },
      { cwd: '/x', modeSignal: signal },
    );
    expect(r.isError).toBeFalsy();
    expect(signal.enterPlanMode).toBe(true);
    expect(r.content).toContain('the refactor touches many files');
    expect((r.data as { enterPlanMode: boolean }).enterPlanMode).toBe(true);
  });

  it('still succeeds when no modeSignal is passed (best-effort)', async () => {
    const r = await EnterPlanModeTool.execute({}, { cwd: '/x' });
    expect(r.isError).toBeFalsy();
    expect((r.data as { enterPlanMode: boolean }).enterPlanMode).toBe(true);
  });

  it('uses a generic message when no reason is given', async () => {
    const r = await EnterPlanModeTool.execute({}, { cwd: '/x' });
    expect(r.content).toMatch(/Entering plan mode/);
  });
});
