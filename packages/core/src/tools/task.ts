// Task tool — dispatch a focused sub-agent for a self-contained piece of work.
// Mirrors Claude Code's Task tool. The actual sub-agent run is provided by the
// agent loop via ctx.runSubAgent (it has the provider/model/tools in scope);
// this tool is just the schema + a thin call into it.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13a / §0.1 (parity tool)

import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface TaskInput {
  /** Short label for the work (3-5 words). */
  description?: string;
  /** The full instruction for the sub-agent — it has no other context. */
  prompt?: string;
  /** Named sub-agent from .deepcode/agents/*.md; omit for a generic one. */
  subagent_type?: string;
}

export const TaskTool: ToolHandler = {
  name: 'Task',
  definition: {
    name: 'Task',
    description:
      'Launch a focused sub-agent to handle a self-contained, multi-step task and return only its conclusion (not its intermediate work). Use for broad searches/research where you want the result, not the file dumps, or to parallelize independent investigations. The sub-agent runs in a fresh context with no memory of this conversation — put everything it needs in `prompt`. Optionally target a named sub-agent from .deepcode/agents via `subagent_type`. The sub-agent cannot spawn further sub-agents.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short (3-5 word) task label.' },
        prompt: {
          type: 'string',
          description: 'Self-contained instruction — the sub-agent sees nothing else.',
        },
        subagent_type: {
          type: 'string',
          description: 'Optional named sub-agent (.deepcode/agents/<name>.md).',
        },
      },
      required: ['prompt'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as TaskInput;
    const prompt = input?.prompt?.trim();
    if (!prompt) {
      return { content: 'Error: Task requires a non-empty `prompt`.', isError: true };
    }
    if (!ctx.runSubAgent) {
      // No sub-agent runner wired (renderer, or a sub-agent already at max
      // recursion depth). Fail clearly rather than silently no-op.
      return {
        content:
          'Error: sub-agents are not available here (already inside a sub-agent, or the host did not enable Task). Do the work directly.',
        isError: true,
      };
    }
    try {
      const result = await ctx.runSubAgent({
        prompt,
        agentType: input.subagent_type,
        description: input.description,
      });
      return {
        content: result.text || '(sub-agent produced no output)',
        data: {
          agentType: result.agentType,
          turnsUsed: result.turnsUsed,
          description: input.description,
        },
      };
    } catch (err) {
      return { content: `Error running sub-agent: ${(err as Error).message}`, isError: true };
    }
  },
};
