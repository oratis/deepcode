// AskUserQuestion tool — agent asks the user a multiple-choice question.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 (M3c-rest)
//
// The actual prompt UX lives in the host (CLI shows the prompt + readline;
// future GUI shows a modal). The tool delegates via ToolContext.askUser; if
// that callback is absent (headless), it returns an error.

import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface AskInput {
  question: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  header?: string;
}

export const AskUserQuestionTool: ToolHandler = {
  name: 'AskUserQuestion',
  definition: {
    name: 'AskUserQuestion',
    description:
      'Ask the user a multiple-choice question and wait for the answer. Use when the agent needs the user to disambiguate or pick between approaches. Each option needs a short label and a description. The host always adds an implicit "Other" option for free text. Requires interactive mode — fails in headless.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The full question. Should end with a question mark.',
        },
        header: {
          type: 'string',
          description: 'Optional short chip label (≤12 chars). E.g. "Auth method".',
        },
        options: {
          type: 'array',
          description: '2-4 mutually exclusive options.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short option text (1-5 words).' },
              description: { type: 'string', description: 'Explanation of what this option means.' },
            },
            required: ['label'],
          },
        },
        multiSelect: {
          type: 'boolean',
          description: 'Allow the user to pick multiple options. Default false.',
        },
      },
      required: ['question'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as AskInput;
    if (!input?.question || typeof input.question !== 'string') {
      return { content: 'Error: question is required (string).', isError: true };
    }
    if (!ctx.askUser) {
      return {
        content:
          'Error: cannot ask user — no interactive host available (running headless or in a sub-agent). Decide based on context instead.',
        isError: true,
      };
    }
    const options = (input.options ?? []).map((o) => ({
      label: o.label,
      description: o.description ?? '',
    }));
    if (options.length > 4) {
      return { content: 'Error: at most 4 options allowed.', isError: true };
    }
    try {
      const answer = await ctx.askUser({
        question: input.question,
        options,
        multiSelect: !!input.multiSelect,
      });
      return { content: answer, data: { question: input.question, answer } };
    } catch (err) {
      return { content: `Error during user prompt: ${(err as Error).message}`, isError: true };
    }
  },
};
