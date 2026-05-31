// TaskCreate / TaskList / TaskGet / TaskOutput / TaskUpdate / TaskStop / Monitor
// — drive the background-task manager (ctx.tasks). Spec: §3.15.3.
//
// A background task runs a sub-agent concurrently with the main turn; the agent
// kicks one off with TaskCreate, keeps working, then Monitor/TaskOutput collect
// the result. All no-op gracefully when ctx.tasks is absent (sub-agent / no host).

import type { ToolContext, ToolHandler, ToolResult } from '../types.js';

function noManager(): ToolResult {
  return {
    content: 'Background tasks are unavailable here (only the top-level agent can create them).',
    isError: true,
  };
}

export const TaskCreateTool: ToolHandler = {
  name: 'TaskCreate',
  definition: {
    name: 'TaskCreate',
    description:
      'Start a background task: a sub-agent runs `prompt` concurrently while you keep working. Returns a task id immediately — use Monitor/TaskOutput to collect the result, TaskStop to cancel.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Short label for the task.' },
        prompt: { type: 'string', description: 'What the background sub-agent should do.' },
        agentType: { type: 'string', description: 'Optional named sub-agent to use.' },
      },
      required: ['prompt'],
    },
  },
  async execute(raw, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.tasks) return noManager();
    const input = raw as { description?: string; prompt?: string; agentType?: string };
    if (!input.prompt) return { content: 'Error: prompt is required.', isError: true };
    const task = ctx.tasks.create({
      description: input.description ?? input.prompt.slice(0, 60),
      prompt: input.prompt,
      agentType: input.agentType,
    });
    return {
      content: `Started background task ${task.id} ("${task.description}"). Use Monitor("${task.id}") to await it.`,
      data: { id: task.id },
    };
  },
};

export const TaskListTool: ToolHandler = {
  name: 'TaskList',
  definition: {
    name: 'TaskList',
    description: 'List background tasks (id, status, description).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  async execute(_raw, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.tasks) return noManager();
    const tasks = ctx.tasks.list();
    if (tasks.length === 0) return { content: 'No background tasks.' };
    return {
      content: tasks.map((t) => `${t.id}  [${t.status}]  ${t.description}`).join('\n'),
      data: { tasks },
    };
  },
};

export const TaskGetTool: ToolHandler = {
  name: 'TaskGet',
  definition: {
    name: 'TaskGet',
    description: "Get a background task's status + metadata by id.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  async execute(raw, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.tasks) return noManager();
    const { id } = raw as { id?: string };
    const task = id ? ctx.tasks.get(id) : undefined;
    if (!task) return { content: `No task "${id}".`, isError: true };
    return {
      content: `${task.id} [${task.status}] "${task.description}" (created ${task.createdAt}${task.finishedAt ? `, finished ${task.finishedAt}` : ''})`,
      data: { task },
    };
  },
};

export const TaskOutputTool: ToolHandler = {
  name: 'TaskOutput',
  definition: {
    name: 'TaskOutput',
    description: "Read a background task's output so far (empty until it produces results).",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  async execute(raw, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.tasks) return noManager();
    const { id } = raw as { id?: string };
    const task = id ? ctx.tasks.get(id) : undefined;
    if (!task) return { content: `No task "${id}".`, isError: true };
    return {
      content: task.output || `(task ${task.id} is ${task.status} with no output yet)`,
      data: { id: task.id, status: task.status },
    };
  },
};

export const TaskUpdateTool: ToolHandler = {
  name: 'TaskUpdate',
  definition: {
    name: 'TaskUpdate',
    description: "Update a background task's description.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, description: { type: 'string' } },
      required: ['id', 'description'],
    },
  },
  async execute(raw, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.tasks) return noManager();
    const { id, description } = raw as { id?: string; description?: string };
    if (!id || description === undefined) {
      return { content: 'Error: id and description are required.', isError: true };
    }
    return ctx.tasks.update(id, { description })
      ? { content: `Updated task ${id}.` }
      : { content: `No task "${id}".`, isError: true };
  },
};

export const TaskStopTool: ToolHandler = {
  name: 'TaskStop',
  definition: {
    name: 'TaskStop',
    description: 'Cancel a running background task by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  async execute(raw, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.tasks) return noManager();
    const { id } = raw as { id?: string };
    if (!id) return { content: 'Error: id is required.', isError: true };
    return ctx.tasks.stop(id)
      ? { content: `Stopped task ${id}.` }
      : { content: `Task "${id}" is unknown or already finished.`, isError: true };
  },
};

export const MonitorTool: ToolHandler = {
  name: 'Monitor',
  definition: {
    name: 'Monitor',
    description:
      'Wait for a background task to finish and return its final output. Blocks until the task completes, fails, or is stopped.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  async execute(raw, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.tasks) return noManager();
    const { id } = raw as { id?: string };
    if (!id) return { content: 'Error: id is required.', isError: true };
    if (!ctx.tasks.get(id)) return { content: `No task "${id}".`, isError: true };
    const task = await ctx.tasks.wait(id);
    if (!task) return { content: `No task "${id}".`, isError: true };
    return {
      content: `Task ${task.id} ${task.status}.\n\n${task.output}`,
      isError: task.status === 'failed',
      data: { status: task.status },
    };
  },
};

export const TASK_TOOLS: ToolHandler[] = [
  TaskCreateTool,
  TaskListTool,
  TaskGetTool,
  TaskOutputTool,
  TaskUpdateTool,
  TaskStopTool,
  MonitorTool,
];
