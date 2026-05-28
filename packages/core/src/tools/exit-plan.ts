// ExitPlanMode tool — signals the host that the agent is done planning and
// wants to start executing. Host flips mode from 'plan' to 'default'.
// Spec: docs/DEVELOPMENT_PLAN.md §3.8 (M3c-rest)

import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface ExitInput {
  plan?: string;
}

export const ExitPlanModeTool: ToolHandler = {
  name: 'ExitPlanMode',
  definition: {
    name: 'ExitPlanMode',
    description:
      "Signal that the plan is complete and the agent wants to leave plan mode to start executing. The host changes the active mode from 'plan' to 'default'. Pass `plan` to summarize what you intend to do.",
    inputSchema: {
      type: 'object',
      properties: {
        plan: {
          type: 'string',
          description:
            'Short summary of the plan to be executed (shown to the user before they approve the mode switch).',
        },
      },
      required: [],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as ExitInput;
    if (ctx.modeSignal) ctx.modeSignal.exitPlanMode = true;
    const plan = input?.plan?.trim() ?? '';
    const msg = plan
      ? `Exiting plan mode. Plan: ${plan}`
      : 'Exiting plan mode — agent will begin executing.';
    return {
      content: msg,
      data: { exitPlanMode: true, plan },
    };
  },
};
