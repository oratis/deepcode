import { describe, expect, it } from 'vitest';
import { ExitPlanModeTool } from './exit-plan.js';

describe('ExitPlanModeTool', () => {
  it('flips modeSignal.exitPlanMode and returns the plan summary', async () => {
    const signal: { exitPlanMode?: boolean } = {};
    const r = await ExitPlanModeTool.execute(
      { plan: 'Refactor auth into separate module.' },
      { cwd: '/x', modeSignal: signal },
    );
    expect(r.isError).toBeFalsy();
    expect(signal.exitPlanMode).toBe(true);
    expect(r.content).toContain('Refactor auth');
    expect((r.data as { exitPlanMode: boolean }).exitPlanMode).toBe(true);
  });

  it('still succeeds when no modeSignal is passed (best-effort)', async () => {
    const r = await ExitPlanModeTool.execute({}, { cwd: '/x' });
    expect(r.isError).toBeFalsy();
    expect((r.data as { exitPlanMode: boolean }).exitPlanMode).toBe(true);
  });

  it('omits "Plan: ..." when plan is empty', async () => {
    const r = await ExitPlanModeTool.execute({ plan: '' }, { cwd: '/x' });
    expect(r.content).toMatch(/Exiting plan mode/);
    expect(r.content).not.toMatch(/Plan:/);
  });
});
