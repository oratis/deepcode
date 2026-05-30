// EnterPlanMode tool — signals the host that the agent wants to STOP executing
// and switch into read-only "plan" mode (present a plan before touching files).
// Mirror of ExitPlanMode. The agent-loop owner reads modeSignal.enterPlanMode
// after the run and switches the active mode default → plan.
// Spec: docs/DEVELOPMENT_PLAN.md §3.8 / §0.1 (parity tool)

import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface EnterInput {
  reason?: string;
}

export const EnterPlanModeTool: ToolHandler = {
  name: 'EnterPlanMode',
  definition: {
    name: 'EnterPlanMode',
    description:
      'Switch into plan mode: stop making changes and instead research + present a plan for approval before executing. Use when a task is ambiguous or risky enough that the user should review the approach first. Write/Edit/Bash become blocked until the user leaves plan mode (or you call ExitPlanMode). Pass `reason` to explain why planning first.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why planning first is warranted (shown to the user).',
        },
      },
      required: [],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as EnterInput;
    if (ctx.modeSignal) ctx.modeSignal.enterPlanMode = true;
    const reason = input?.reason?.trim() ?? '';
    return {
      content: reason
        ? `Entering plan mode — ${reason}. I'll research and present a plan before making changes.`
        : "Entering plan mode — I'll research and present a plan before making changes.",
      data: { enterPlanMode: true, reason },
    };
  },
};
