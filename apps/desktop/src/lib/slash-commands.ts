// Slash commands the desktop can actually serve.
//
// The CLI's 38 commands run against a SessionContext full of node:fs, a
// provider and a session manager — none of which exist in a WebView. Rather
// than stub them, this catalogue lists only what the renderer can do itself or
// through an existing protocol method, and `/help` says where the rest live.
// Anything needing host execution (/init, /compact, /rewind, /export) waits on
// a protocol method to carry it; it is not faked here.
//
// Pure: parsing and filtering have no React or Tauri dependency, so the whole
// surface is unit-testable.

import type { ScreenName } from '../types/screens.js';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AgentMode =
  'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions';

export interface SlashCommand {
  /** Including the leading slash. */
  name: string;
  /** Argument hint shown in the palette, e.g. `<tier>`. */
  args?: string;
  summary: string;
}

export const MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const;
export const MODES: AgentMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
  'bypassPermissions',
];
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const DESKTOP_COMMANDS: SlashCommand[] = [
  { name: '/help', summary: 'List the commands available here' },
  { name: '/clear', summary: 'Start a new conversation' },
  { name: '/model', args: '<id>', summary: 'Switch model (deepseek-chat | deepseek-reasoner)' },
  {
    name: '/mode',
    args: '<name>',
    summary: 'Switch approval mode (default, plan, acceptEdits, …)',
  },
  { name: '/plan', args: '[off]', summary: 'Enter plan mode (read-only); /plan off leaves it' },
  { name: '/effort', args: '<tier>', summary: 'Switch effort tier (low … max)' },
  { name: '/cost', summary: 'Spend and token usage this conversation' },
  { name: '/context', summary: 'How much of the context window is used' },
  { name: '/diff', summary: 'Uncommitted changes in the working tree' },
  { name: '/settings', summary: 'Open settings' },
  { name: '/permissions', summary: 'Open the permission rules' },
  { name: '/mcp', summary: 'Open the MCP server manager' },
  { name: '/plugins', summary: 'Open installed plugins' },
  { name: '/skills', summary: 'Open available skills' },
  { name: '/about', summary: 'Version, paths and configuration diagnostics' },
];

export type SlashAction =
  | { kind: 'help' }
  | { kind: 'clear' }
  | { kind: 'set-model'; value: string }
  | { kind: 'set-mode'; value: AgentMode }
  | { kind: 'set-effort'; value: Effort }
  | { kind: 'cost' }
  | { kind: 'context' }
  | { kind: 'diff' }
  | { kind: 'navigate'; screen: ScreenName }
  | { kind: 'error'; message: string };

const SCREEN_COMMANDS: Record<string, ScreenName> = {
  '/settings': 'settings',
  '/permissions': 'permissions',
  '/mcp': 'mcp',
  '/plugins': 'plugins',
  '/skills': 'skills',
  '/about': 'about',
};

/** Commands matching what the user has typed so far, in catalogue order. */
export function filterCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return [];
  // A space means the user has moved past choosing a command — they are typing
  // an argument, or prose that happens to start with a slash. Either way, stop
  // suggesting rather than hovering a list over what they're writing.
  if (/\s/.test(input)) return [];
  const token = input.toLowerCase();
  return DESKTOP_COMMANDS.filter((c) => c.name.startsWith(token));
}

/**
 * Resolve typed input to an action. Returns null when this is not a slash
 * command, so the caller sends it to the model unchanged.
 */
export function parseSlash(input: string): SlashAction | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const [name, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ').trim();
  const command = (name ?? '').toLowerCase();

  const screen = SCREEN_COMMANDS[command];
  if (screen) return { kind: 'navigate', screen };

  switch (command) {
    case '/help':
      return { kind: 'help' };
    case '/clear':
      return { kind: 'clear' };
    case '/cost':
      return { kind: 'cost' };
    case '/context':
      return { kind: 'context' };
    case '/diff':
      return { kind: 'diff' };
    case '/model':
      return (MODELS as readonly string[]).includes(arg)
        ? { kind: 'set-model', value: arg }
        : { kind: 'error', message: `Usage: /model ${MODELS.join(' | ')}` };
    case '/mode':
      return (MODES as string[]).includes(arg)
        ? { kind: 'set-mode', value: arg as AgentMode }
        : { kind: 'error', message: `Usage: /mode ${MODES.join(' | ')}` };
    case '/plan':
      // Same switch /mode plan throws, one word shorter. A trailing prompt is
      // refused rather than silently dropped — type it as a normal message.
      if (arg === '' || arg === 'off') {
        return { kind: 'set-mode', value: arg === 'off' ? 'default' : 'plan' };
      }
      return {
        kind: 'error',
        message: '/plan takes no prompt — enter plan mode, then type your message.',
      };
    case '/effort':
      return (EFFORTS as string[]).includes(arg)
        ? { kind: 'set-effort', value: arg as Effort }
        : { kind: 'error', message: `Usage: /effort ${EFFORTS.join(' | ')}` };
    default:
      return {
        kind: 'error',
        message: `Unknown command ${command}. Type /help for the list.`,
      };
  }
}

/** Body of `/help` — the catalogue plus an honest note about the rest. */
export function helpText(): string {
  const width = Math.max(...DESKTOP_COMMANDS.map((c) => `${c.name} ${c.args ?? ''}`.trim().length));
  const rows = DESKTOP_COMMANDS.map((c) => {
    const left = `${c.name} ${c.args ?? ''}`.trim();
    return `${left.padEnd(width)}  ${c.summary}`;
  });
  return [
    'Commands available in the desktop app:',
    '',
    ...rows,
    '',
    'Commands that run on the host (/init, /compact, /rewind, /export, /todos …)',
    'are CLI-only for now — run `deepcode` in this folder to use them.',
  ].join('\n');
}

/** `/diff` output — a summary line per changed file, capped. */
export function formatWorkspaceDiff(result: {
  repository: boolean;
  base: 'HEAD' | 'empty' | null;
  files: Array<{ path: string; status: string; additions: number; deletions: number }>;
  truncated: boolean;
}): string {
  if (!result.repository) return 'Not a Git repository — nothing to diff.';
  if (result.files.length === 0) return 'Working tree clean.';

  const width = Math.max(...result.files.map((f) => f.path.length));
  const rows = result.files.map(
    (f) => `${f.path.padEnd(width)}  ${f.status.padEnd(9)} +${f.additions} -${f.deletions}`,
  );
  const totals = result.files.reduce(
    (acc, f) => ({ add: acc.add + f.additions, del: acc.del + f.deletions }),
    { add: 0, del: 0 },
  );
  return [
    `${result.files.length} changed file${result.files.length === 1 ? '' : 's'} ` +
      `(+${totals.add} -${totals.del})`,
    '',
    ...rows,
    ...(result.truncated ? ['', 'Output truncated — the diff is larger than the cap.'] : []),
  ].join('\n');
}
