// Tools subsystem entry — P0 tools + M3c-rest extensions + registry.
// Spec: docs/DEVELOPMENT_PLAN.md §3.2
// Milestone: M1 (P0) + M3c-rest (TodoWrite/WebFetch/WebSearch)

export { ReadTool } from './read.js';
export { WriteTool } from './write.js';
export { EditTool } from './edit.js';
export { BashTool } from './bash.js';
export { GrepTool } from './grep.js';
export { GlobTool } from './glob.js';
export { TodoWriteTool, readTodos, TODO_FILE } from './todo.js';
export type { TodoItem, TodoStatus } from './todo.js';
export { WebFetchTool } from './web-fetch.js';
export { WebSearchTool, parseDuckDuckGoHtml } from './web-search.js';
export type { SearchHit } from './web-search.js';
export { AskUserQuestionTool } from './ask-user.js';
export { ExitPlanModeTool } from './exit-plan.js';
export { CronCreateTool, CronListTool, CronDeleteTool } from './cron-tools.js';
export {
  makeToolSearchTool,
  installToolSearch,
  RegistryDeferredStore,
  type DeferredToolEntry,
  type DeferredToolStore,
  type ToolSearchRegistry,
} from './tool-search.js';
export { ToolRegistry, BUILTIN_TOOLS } from './registry.js';
export type { ToolDefinition, ToolContext, ToolResult, ToolHandler } from './types.js';
