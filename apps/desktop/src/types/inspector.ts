// Shared data shape for the right-hand inspector panel (design spec screen #3).
//
// The panel's four sections (Plan · Context · Recent files · Session info) are
// fed by state that originates in ReplScreen (token usage, tool activity) and
// in App (project / model / mode). ReplScreen lifts its slice up via a single
// `onInspector` callback; App merges it into one InspectorData object that both
// the collapsed rail (badges) and the expanded panel render from.

/**
 * The four inspector sections, in render order. The collapsed rail's middle
 * icons each map to one — clicking expands the panel and scrolls to it.
 */
export type InspectorSection = 'plan' | 'context' | 'files' | 'session';

/** Mirrors core's TodoWrite item shape (kept local to avoid a dist type-dep). */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export interface TodoItem {
  content: string;
  /** First-person continuous form, shown while the item is in_progress. */
  activeForm: string;
  status: TodoStatus;
}

export interface InspectorData {
  /** Latest provider round-trip token counts — drives the Context section. */
  usage: { inputTokens: number; outputTokens: number };
  /** Cumulative spend this conversation (¥) — shown in Session info. */
  costYuan: number;
  /** Active model id — Context denominator (contextWindowFor) + Session info. */
  model: string;
  /** Permission mode — Session info. */
  mode: string;
  /** Files touched by Write/Edit/MultiEdit this conversation, most-recent first. */
  recentFiles: string[];
  /** Latest TodoWrite list — drives the Plan section. */
  todos: TodoItem[];
}

/** Initial empty inspector state. */
export function emptyInspectorData(model = 'deepseek-chat', mode = 'default'): InspectorData {
  return {
    usage: { inputTokens: 0, outputTokens: 0 },
    costYuan: 0,
    model,
    mode,
    recentFiles: [],
    todos: [],
  };
}
