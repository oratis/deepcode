// System reminders — short, context-aware messages prepended to a user turn
// to refresh the agent's awareness of things it might forget over a long
// conversation (today's date, pending todos, files modified externally, etc.).
//
// Spec: docs/DEVELOPMENT_PLAN.md §3.6 "System-reminder injector (7 types)".
// Wired in by the agent loop just before sending the user message.
//
// Design choices:
//   · Each builder is a pure function that returns `string | null`.
//   · The composite buildSystemReminders() returns null if no reminders fire,
//     so the agent loop can skip the injection entirely.
//   · Reminders are wrapped in <system-reminder>...</system-reminder> tags
//     before the user message so the model treats them as authoritative.
//   · Per-builder failure does NOT poison the whole batch — we catch + drop.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { TodoItem } from '../tools/todo.js';
import { readTodos } from '../tools/todo.js';

export interface ReminderContext {
  /** Current working directory. */
  cwd: string;
  /** Optional session dir (where todos.json lives). */
  sessionDir?: string;
  /**
   * Files the agent has read or written in this session, with mtime at the
   * time of access. Used to detect external modifications between turns.
   */
  knownFiles?: Map<string, number>;
  /** Current agent mode — surfaced when 'plan'. */
  mode?: string;
  /**
   * Last time the user ran tests in this session (epoch ms). Stale-test
   * reminder fires when > 10min since last run AND at least one Edit/Write
   * has happened since then.
   */
  lastTestRunAt?: number;
  /** Whether any Edit/Write tool call has fired since lastTestRunAt. */
  editsSinceTests?: number;
  /** Override `now()` for tests. */
  now?: () => Date;
}

export interface ReminderOptions {
  /**
   * Which reminders to evaluate. If omitted, all builders run.
   * Useful for opt-out via settings.
   */
  enabled?: ReminderType[];
}

export type ReminderType =
  | 'date'
  | 'cwd'
  | 'agents-md-missing'
  | 'todos-pending'
  | 'external-file-modified'
  | 'plan-mode-active'
  | 'no-test-yet';

/**
 * Build the composite system-reminder block. Returns null if no individual
 * reminder fires.
 */
export async function buildSystemReminders(
  ctx: ReminderContext,
  opts: ReminderOptions = {},
): Promise<string | null> {
  const enabled = new Set(opts.enabled ?? ALL_TYPES);
  const builders: Array<{ type: ReminderType; build: () => Promise<string | null> }> = [
    { type: 'date', build: () => Promise.resolve(dateReminder(ctx)) },
    { type: 'cwd', build: () => Promise.resolve(cwdReminder(ctx)) },
    { type: 'agents-md-missing', build: () => agentsMdMissingReminder(ctx) },
    { type: 'todos-pending', build: () => todosPendingReminder(ctx) },
    { type: 'external-file-modified', build: () => externalFileModifiedReminder(ctx) },
    { type: 'plan-mode-active', build: () => Promise.resolve(planModeActiveReminder(ctx)) },
    { type: 'no-test-yet', build: () => Promise.resolve(noTestYetReminder(ctx)) },
  ];

  const parts: string[] = [];
  for (const { type, build } of builders) {
    if (!enabled.has(type)) continue;
    try {
      const out = await build();
      if (out) parts.push(out);
    } catch {
      // ignore individual builder failures
    }
  }
  if (parts.length === 0) return null;
  return `<system-reminder>\n${parts.join('\n\n')}\n</system-reminder>`;
}

const ALL_TYPES: ReminderType[] = [
  'date',
  'cwd',
  'agents-md-missing',
  'todos-pending',
  'external-file-modified',
  'plan-mode-active',
  'no-test-yet',
];

// ──────────────────────────────────────────────────────────────────────────
// Individual reminder builders
// ──────────────────────────────────────────────────────────────────────────

export function dateReminder(ctx: ReminderContext): string {
  const now = ctx.now ? ctx.now() : new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `Today's date is ${yyyy}-${mm}-${dd} (UTC).`;
}

export function cwdReminder(ctx: ReminderContext): string {
  return `Current working directory: ${ctx.cwd}`;
}

export async function agentsMdMissingReminder(ctx: ReminderContext): Promise<string | null> {
  // If AGENTS.md or DEEPCODE.md exists in cwd, no reminder. Otherwise nudge.
  for (const name of ['AGENTS.md', 'DEEPCODE.md', 'CLAUDE.md']) {
    try {
      await fs.access(join(ctx.cwd, name));
      return null;
    } catch {
      /* keep checking */
    }
  }
  return `No AGENTS.md / DEEPCODE.md found in cwd. You can ask the user to run \`/init\` to create one.`;
}

export async function todosPendingReminder(ctx: ReminderContext): Promise<string | null> {
  if (!ctx.sessionDir) return null;
  let todos: TodoItem[];
  try {
    todos = await readTodos(ctx.sessionDir);
  } catch {
    return null;
  }
  if (todos.length === 0) return null;
  const counts = { pending: 0, in_progress: 0, completed: 0 };
  for (const t of todos) counts[t.status]++;
  // Surface only if any work remains and at least one is in_progress OR pending.
  if (counts.in_progress === 0 && counts.pending === 0) return null;
  const lines = [`Pending todos (${counts.pending + counts.in_progress} of ${todos.length}):`];
  for (const t of todos) {
    if (t.status === 'completed') continue;
    const marker = t.status === 'in_progress' ? '●' : '○';
    const txt = t.status === 'in_progress' ? t.activeForm : t.content;
    lines.push(`  ${marker} ${txt}`);
  }
  return lines.join('\n');
}

export async function externalFileModifiedReminder(ctx: ReminderContext): Promise<string | null> {
  if (!ctx.knownFiles || ctx.knownFiles.size === 0) return null;
  const drifted: Array<{ path: string; was: number; now: number }> = [];
  for (const [path, was] of ctx.knownFiles) {
    try {
      const stat = await fs.stat(path);
      const now = stat.mtimeMs;
      if (Math.abs(now - was) > 1000) drifted.push({ path, was, now });
    } catch {
      // file no longer exists — count as drifted
      drifted.push({ path, was, now: 0 });
    }
  }
  if (drifted.length === 0) return null;
  const list = drifted
    .slice(0, 5)
    .map((d) => `  - ${d.path}`)
    .join('\n');
  const more = drifted.length > 5 ? `\n  ... and ${drifted.length - 5} more` : '';
  return `Files modified externally since you last read them:\n${list}${more}\nRe-read them with the Read tool before editing.`;
}

export function planModeActiveReminder(ctx: ReminderContext): string | null {
  if (ctx.mode !== 'plan') return null;
  return (
    'You are in PLAN MODE. Write (Write/Edit) and exec (Bash) tools are blocked. ' +
    'When the plan is ready, call ExitPlanMode to switch to default mode.'
  );
}

const STALE_TEST_THRESHOLD_MS = 10 * 60 * 1000;

export function noTestYetReminder(ctx: ReminderContext): string | null {
  if (!ctx.editsSinceTests || ctx.editsSinceTests === 0) return null;
  const now = ctx.now ? ctx.now().getTime() : Date.now();
  if (ctx.lastTestRunAt && now - ctx.lastTestRunAt < STALE_TEST_THRESHOLD_MS) return null;
  return (
    `You have made ${ctx.editsSinceTests} edit(s) since the last test run. ` +
    'Consider running tests before declaring the task complete.'
  );
}

/**
 * Convenience: format reminders to be appended to the front of the user
 * message text. Returns the original text unchanged if no reminders fire.
 */
export async function prependReminders(
  userMessage: string,
  ctx: ReminderContext,
  opts?: ReminderOptions,
): Promise<string> {
  const block = await buildSystemReminders(ctx, opts);
  if (!block) return userMessage;
  return `${block}\n\n${userMessage}`;
}
