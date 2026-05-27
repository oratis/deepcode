// Output styles loader — `~/.deepcode/output-styles/*.md` and built-ins.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13b

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter } from '../skills/frontmatter.js';

export interface OutputStyleFrontmatter {
  name: string;
  description?: string;
  /** Whether to keep the default "how to write code" instructions in the system prompt. */
  'keep-coding-instructions'?: boolean;
}

export interface OutputStyle {
  name: string;
  frontmatter: OutputStyleFrontmatter;
  /** Markdown body — appended to the system prompt when style is active. */
  body: string;
  source: 'builtin' | 'user' | 'project';
}

export interface LoadOutputStylesOpts {
  cwd: string;
  home?: string;
}

/** Built-in styles (M4 ships 4 — matches §3.13b table). */
export const BUILTIN_STYLES: OutputStyle[] = [
  {
    name: 'default',
    frontmatter: {
      name: 'default',
      description: 'Concise, direct, minimal preamble.',
      'keep-coding-instructions': true,
    },
    body: '',
    source: 'builtin',
  },
  {
    name: 'explanatory',
    frontmatter: {
      name: 'explanatory',
      description: 'Explain reasoning alongside changes; helpful for learning.',
      'keep-coding-instructions': true,
    },
    body:
      'When you produce changes, also: ' +
      '(1) briefly explain why; ' +
      '(2) point out any non-obvious side effects; ' +
      '(3) note one thing a newcomer should watch out for. ' +
      'Avoid restating obvious code; diffs are sufficient.',
    source: 'builtin',
  },
  {
    name: 'learning',
    frontmatter: {
      name: 'learning',
      description: 'Teaching mode — guide the user to write the key code themselves.',
      'keep-coding-instructions': false,
    },
    body:
      'You are in teaching mode. Provide a skeleton or hint, but let the user write key logic. ' +
      'After each step, ask one clarifying question to check understanding. ' +
      'When the user gets it right, affirm clearly.',
    source: 'builtin',
  },
  {
    name: 'proactive',
    frontmatter: {
      name: 'proactive',
      description: 'Volunteer next steps and risk callouts.',
      'keep-coding-instructions': true,
    },
    body:
      'Beyond answering, proactively: ' +
      '(a) propose 1-2 reasonable next steps; ' +
      '(b) flag any risks or surprising assumptions; ' +
      "(c) if you notice tech debt nearby, mention it (don't auto-fix unless asked).",
    source: 'builtin',
  },
];

export async function loadOutputStyles(opts: LoadOutputStylesOpts): Promise<OutputStyle[]> {
  const home = opts.home ?? homedir();
  const out: OutputStyle[] = [...BUILTIN_STYLES];
  await loadFromDir(join(home, '.deepcode', 'output-styles'), 'user', out);
  await loadFromDir(join(opts.cwd, '.deepcode', 'output-styles'), 'project', out);
  return out;
}

async function loadFromDir(
  root: string,
  source: OutputStyle['source'],
  out: OutputStyle[],
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
    const front = fields as unknown as Partial<OutputStyleFrontmatter>;
    if (!front.name) continue;
    // User/project overrides displace any earlier entry with same name
    const existing = out.findIndex((s) => s.name === front.name);
    const next: OutputStyle = {
      name: front.name,
      frontmatter: front as OutputStyleFrontmatter,
      body,
      source,
    };
    if (existing >= 0) out[existing] = next;
    else out.push(next);
  }
}

export function findStyle(styles: OutputStyle[], name: string): OutputStyle | undefined {
  return styles.find((s) => s.name === name);
}

/**
 * Append a style's body to a base system prompt.
 * If the style has `keep-coding-instructions: false`, the caller is expected
 * to omit the default "how to write code" boilerplate.
 */
export function applyStyle(basePrompt: string, style: OutputStyle | undefined): string {
  if (!style || !style.body) return basePrompt;
  return basePrompt + '\n\n## Output style: ' + style.name + '\n\n' + style.body;
}
