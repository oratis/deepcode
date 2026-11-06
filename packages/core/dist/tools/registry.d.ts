import type { ToolHandler } from '../types.js';
/**
 * Built-in tools shipped by default.
 *   · 6 P0 tools from M1 (Read/Write/Edit/Bash/Grep/Glob)
 *   · 3 M3c-rest tools (TodoWrite/WebFetch/WebSearch)
 *   · 3 agent-control tools (AskUserQuestion/EnterPlanMode/ExitPlanMode)
 *   · 2 worktree tools + Task (sub-agent)
 *   · 3 cron tools (CronCreate/CronList/CronDelete)
 */
export declare const BUILTIN_TOOLS: ToolHandler[];
export declare class ToolRegistry {
    private readonly tools;
    constructor(initial?: ToolHandler[]);
    register(tool: ToolHandler): void;
    get(name: string): ToolHandler | undefined;
    list(): ToolHandler[];
    /** ToolDefinition[] suitable to pass to a provider. */
    definitions(): import("./types.js").ToolDefinition[];
}
//# sourceMappingURL=registry.d.ts.map