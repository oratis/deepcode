// Custom slash commands — user/project `.deepcode/commands/*.md` files.
// Each file is a prompt template invoked as `/<filename> [args]`; its body
// (after optional frontmatter) is expanded with the arguments and submitted to
// the agent as the user prompt. Mirrors Claude Code's custom commands.
// Spec: docs/DEVELOPMENT_PLAN.md §3.6
//
// Built-in interactive commands (/help, /model, /clear, …) live in the CLI
// (apps/cli/src/commands.ts); these are the file-defined, prompt-template ones.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter } from '../skills/frontmatter.js';

export interface CustomCommand {
  /** Invocation name including the leading slash, e.g. `/review`. */
  name: string;
  description: string;
  /** Prompt template (the markdown body). */
  body: string;
  /** Hint shown in help, e.g. "<file>". */
  argumentHint?: string;
  source: 'user' | 'project' | 'plugin';
  path: string;
}

export interface LoadSlashCommandsOpts {
  cwd: string;
  /** Override HOME (tests). */
  home?: string;
  /** Installed-plugin directories; each contributes `<dir>/commands/*.md`. */
  pluginDirs?: string[];
}

/**
 * Load custom commands from plugin `<dir>/commands/*.md`, then
 * `~/.deepcode/commands/*.md` (user), then `<cwd>/.deepcode/commands/*.md`
 * (project). Precedence ascends plugin → user → project (later wins on a name
 * clash) so a user/project command can override a plugin's.
 */
export async function loadSlashCommands(opts: LoadSlashCommandsOpts): Promise<CustomCommand[]> {
  const home = opts.home ?? homedir();
  const collected: CustomCommand[] = [];
  for (const dir of opts.pluginDirs ?? []) {
    await loadFromDir(join(dir, 'commands'), 'plugin', collected);
  }
  await loadFromDir(join(home, '.deepcode', 'commands'), 'user', collected);
  await loadFromDir(join(opts.cwd, '.deepcode', 'commands'), 'project', collected);
  // De-dupe by name; later (project) wins.
  const byName = new Map<string, CustomCommand>();
  for (const c of collected) byName.set(c.name, c);
  return [...byName.values()];
}

async function loadFromDir(
  root: string,
  source: CustomCommand['source'],
  out: CustomCommand[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const path = join(root, entry);
    const raw = await fs.readFile(path, 'utf8');
    const { fields, body } = parseFrontmatter(raw);
    const base = entry.replace(/\.md$/, '');
    const hint = fields['argument-hint'];
    out.push({
      name: `/${base}`,
      description: typeof fields.description === 'string' ? fields.description : base,
      body: body.trim(),
      argumentHint: typeof hint === 'string' ? hint : undefined,
      source,
      path,
    });
  }
}

/** Find a loaded command by its invocation name (e.g. `/review`). */
export function findCustomCommand(cmds: CustomCommand[], name: string): CustomCommand | undefined {
  return cmds.find((c) => c.name === name);
}

/**
 * Expand a command body with positional + joined arguments:
 *   `$ARGUMENTS` → all args joined by spaces
 *   `$1`, `$2`, … → individual positional args (empty string if absent)
 */
export function expandCommandBody(body: string, args: string[]): string {
  return body
    .replaceAll('$ARGUMENTS', args.join(' '))
    .replace(/\$(\d+)/g, (_m, n: string) => args[Number(n) - 1] ?? '');
}
