// ExitPlanMode tool — signals the host that the agent is done planning and
// wants to start executing. Host flips mode from 'plan' to 'default'.
// Spec: docs/DEVELOPMENT_PLAN.md §3.8 (M3c-rest)
export const ExitPlanModeTool = {
    name: 'ExitPlanMode',
    definition: {
        name: 'ExitPlanMode',
        description: "Signal that the plan is complete and the agent wants to leave plan mode to start executing. The host changes the active mode from 'plan' to 'default'. Pass `plan` to summarize what you intend to do.",
        inputSchema: {
            type: 'object',
            properties: {
                plan: {
                    type: 'string',
                    description: 'Short summary of the plan to be executed (shown to the user before they approve the mode switch).',
                },
            },
            required: [],
        },
    },
    async execute(rawInput, ctx) {
        const input = rawInput;
        if (ctx.modeSignal)
            ctx.modeSignal.exitPlanMode = true;
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
//# sourceMappingURL=exit-plan.js.map