import { describe, expect, it } from 'vitest';
import { TaskTool } from './task.js';

describe('TaskTool', () => {
  it('errors on empty prompt', async () => {
    const r = await TaskTool.execute({ prompt: '  ' }, { cwd: '/x' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/non-empty/);
  });

  it('errors clearly when no runSubAgent is wired (renderer / max depth)', async () => {
    const r = await TaskTool.execute({ prompt: 'do a thing' }, { cwd: '/x' });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not available/);
  });

  it('delegates to ctx.runSubAgent and returns its text', async () => {
    const r = await TaskTool.execute(
      { prompt: 'explore the routes', subagent_type: 'explorer', description: 'find routes' },
      {
        cwd: '/x',
        runSubAgent: async ({ prompt, agentType }) => ({
          text: `did: ${prompt} via ${agentType}`,
          turnsUsed: 2,
          agentType: agentType ?? 'general',
        }),
      },
    );
    expect(r.isError).toBeFalsy();
    expect(r.content).toBe('did: explore the routes via explorer');
    expect((r.data as { turnsUsed: number }).turnsUsed).toBe(2);
  });

  it('surfaces sub-agent errors', async () => {
    const r = await TaskTool.execute(
      { prompt: 'x' },
      {
        cwd: '/x',
        runSubAgent: async () => {
          throw new Error('unknown subagent_type "nope"');
        },
      },
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/unknown subagent_type/);
  });
});
