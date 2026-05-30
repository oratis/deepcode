// Tool registry — looks up handlers by name, gives the agent loop a single dispatch point.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2

import type { ToolHandler } from '../types.js';
import { AskUserQuestionTool } from './ask-user.js';
import { BashTool } from './bash.js';
import { EditTool } from './edit.js';
import { EnterPlanModeTool } from './enter-plan.js';
import { ExitPlanModeTool } from './exit-plan.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { ReadTool } from './read.js';
import { TodoWriteTool } from './todo.js';
import { WebFetchTool } from './web-fetch.js';
import { WebSearchTool } from './web-search.js';
import { WriteTool } from './write.js';

/**
 * Built-in tools shipped by default.
 *   · 6 P0 tools from M1 (Read/Write/Edit/Bash/Grep/Glob)
 *   · 3 M3c-rest tools (TodoWrite/WebFetch/WebSearch)
 *   · 3 agent-control tools (AskUserQuestion/EnterPlanMode/ExitPlanMode)
 */
export const BUILTIN_TOOLS: ToolHandler[] = [
  ReadTool,
  WriteTool,
  EditTool,
  BashTool,
  GrepTool,
  GlobTool,
  TodoWriteTool,
  WebFetchTool,
  WebSearchTool,
  AskUserQuestionTool,
  EnterPlanModeTool,
  ExitPlanModeTool,
];

export class ToolRegistry {
  private readonly tools = new Map<string, ToolHandler>();

  constructor(initial: ToolHandler[] = BUILTIN_TOOLS) {
    for (const t of initial) this.register(t);
  }

  register(tool: ToolHandler): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  list(): ToolHandler[] {
    return [...this.tools.values()];
  }

  /** ToolDefinition[] suitable to pass to a provider. */
  definitions() {
    return this.list().map((t) => t.definition);
  }
}
