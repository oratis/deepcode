// CronCreate / CronList / CronDelete — schedule recurring headless agent runs.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.4 / §0.1
//
// These CRUD the cron store (~/.deepcode/cron.json). Execution is handled
// separately by `deepcode scheduler run` (fired by the launchd/systemd timer).

import { addCronJob, listCronJobs, removeCronJob, validateCronExpr } from '../cron/index.js';
import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

interface CreateInput {
  schedule?: string;
  prompt?: string;
}
interface DeleteInput {
  id?: string;
}

export const CronCreateTool: ToolHandler = {
  name: 'CronCreate',
  definition: {
    name: 'CronCreate',
    description:
      'Schedule a recurring task: run `prompt` headlessly on a cron `schedule` (5-field cron, e.g. "0 9 * * 1-5" = 9am on weekdays). The job runs in the current project directory. Returns the job id. Jobs only fire while the DeepCode scheduler is installed (`deepcode cron install`).',
    inputSchema: {
      type: 'object',
      properties: {
        schedule: {
          type: 'string',
          description: '5-field cron: min hour day-of-month month day-of-week.',
        },
        prompt: { type: 'string', description: 'What the agent should do each run.' },
      },
      required: ['schedule', 'prompt'],
    },
  },
  async execute(rawInput: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const input = rawInput as unknown as CreateInput;
    if (!input.schedule || !input.prompt) {
      return { content: 'Error: schedule and prompt are required.', isError: true };
    }
    const invalid = validateCronExpr(input.schedule);
    if (invalid) return { content: `Error: ${invalid}`, isError: true };
    try {
      const job = await addCronJob({
        schedule: input.schedule,
        prompt: input.prompt,
        cwd: ctx.cwd,
      });
      return {
        content: `Scheduled "${job.id}" — \`${job.schedule}\` in ${job.cwd}.\nIt fires once the scheduler is installed (deepcode cron install).`,
        data: { id: job.id, schedule: job.schedule },
      };
    } catch (err) {
      return { content: `Error scheduling job: ${(err as Error).message}`, isError: true };
    }
  },
};

export const CronListTool: ToolHandler = {
  name: 'CronList',
  definition: {
    name: 'CronList',
    description: 'List scheduled cron jobs (id, schedule, prompt, enabled, last run).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  async execute(): Promise<ToolResult> {
    const jobs = await listCronJobs();
    if (jobs.length === 0) return { content: 'No scheduled jobs.', data: { jobs: [] } };
    const lines = jobs.map(
      (j) =>
        `${j.id}  [${j.schedule}]${j.enabled ? '' : ' (disabled)'}  ${j.prompt.slice(0, 60)}` +
        (j.lastRunAt ? `  (last: ${j.lastRunAt})` : ''),
    );
    return { content: lines.join('\n'), data: { jobs } };
  },
};

export const CronDeleteTool: ToolHandler = {
  name: 'CronDelete',
  definition: {
    name: 'CronDelete',
    description: 'Delete a scheduled cron job by its id (from CronList).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Job id to delete.' } },
      required: ['id'],
    },
  },
  async execute(rawInput: Record<string, unknown>): Promise<ToolResult> {
    const input = rawInput as unknown as DeleteInput;
    if (!input.id) return { content: 'Error: id is required.', isError: true };
    const removed = await removeCronJob(input.id);
    return removed
      ? { content: `Deleted scheduled job "${input.id}".`, data: { id: input.id } }
      : { content: `No job with id "${input.id}".`, isError: true };
  },
};
