import type { ToolHandler } from '../types.js';
export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export interface TodoItem {
    content: string;
    /** First-person continuous form, shown while the item is in_progress. */
    activeForm: string;
    status: TodoStatus;
}
/** Where the per-session todo list lives — relative to sessionDir. */
export declare const TODO_FILE = "todos.json";
export declare const TodoWriteTool: ToolHandler;
/** Reads the current todo list from a session dir. Returns [] if none. */
export declare function readTodos(sessionDir: string): Promise<TodoItem[]>;
//# sourceMappingURL=todo.d.ts.map