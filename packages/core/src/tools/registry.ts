// Tool registry — looks up handlers by name, gives the agent loop a single dispatch point.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2

import type { ToolHandler } from '../types.js';
import { BashTool } from './bash.js';
import { EditTool } from './edit.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import { ReadTool } from './read.js';
import { WriteTool } from './write.js';

/** The 6 P0 tools shipped in M1. */
export const BUILTIN_TOOLS: ToolHandler[] = [
  ReadTool,
  WriteTool,
  EditTool,
  BashTool,
  GrepTool,
  GlobTool,
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
