// Skills loader — scans the three layers and produces a registry.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13
//
// Layout per skill:
//   <root>/<name>/SKILL.md   (frontmatter + body)
//   <root>/<name>/<asset.ts> (optional helper files)

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Effort } from '../types.js';
import { parseFrontmatter } from './frontmatter.js';

export interface SkillFrontmatter {
  name: string;
  description: string;
  /** Optional allow-list of tools the skill is permitted to call. */
  'allowed-tools'?: string[];
  /** Optional model override. */
  model?: string;
  /** Optional effort override (low/medium/high/xhigh/max). */
  effort?: Effort;
  /** Optional shell for embedded scripts. */
  shell?: string;
  /** Skill-scoped hooks (only fire while this skill is active). */
  hooks?: Record<string, unknown>;
  /** User-toggle: skip loading this skill entirely. */
  disabled?: boolean;
}

export interface Skill {
  /** Either `<name>` (built-in/user/project) or `<plugin>:<name>` (plugin-bundled). */
  qualifiedName: string;
  frontmatter: SkillFrontmatter;
  body: string;
  /** Path to SKILL.md on disk. */
  path: string;
  /** Source layer this came from — for display. */
  source: 'builtin' | 'user' | 'project' | 'plugin';
}

export interface LoadSkillsOpts {
  cwd: string;
  home?: string;
  /** Optional list of plugin directories (M5+). */
  pluginDirs?: string[];
  /** Skill name → { disabled: true } overrides from settings.json. */
  overrides?: Record<string, { disabled?: boolean }>;
  /** Built-in skill dir (for tests). */
  builtinDir?: string;
}

export async function loadSkills(opts: LoadSkillsOpts): Promise<Skill[]> {
  const home = opts.home ?? homedir();
  const out: Skill[] = [];

  // 1. Built-in skills (shipped with DeepCode)
  if (opts.builtinDir) {
    await loadFromDir(opts.builtinDir, 'builtin', out);
  }

  // 2. User-level
  await loadFromDir(join(home, '.deepcode', 'skills'), 'user', out);

  // 3. Project-level
  await loadFromDir(join(opts.cwd, '.deepcode', 'skills'), 'project', out);

  // 4. Plugin-bundled (M5)
  for (const pluginDir of opts.pluginDirs ?? []) {
    const pluginName = pluginDir.split('/').filter(Boolean).pop() ?? 'plugin';
    await loadFromDir(join(pluginDir, 'skills'), 'plugin', out, pluginName);
  }

  // Apply overrides (skip disabled skills)
  const overrides = opts.overrides ?? {};
  return out.filter((s) => !overrides[s.qualifiedName]?.disabled);
}

async function loadFromDir(
  root: string,
  source: Skill['source'],
  out: Skill[],
  pluginName?: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const skillDir = join(root, entry);
    let stat;
    try {
      stat = await fs.stat(skillDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const skillPath = join(skillDir, 'SKILL.md');
    let raw: string;
    try {
      raw = await fs.readFile(skillPath, 'utf8');
    } catch {
      continue;
    }
    const { fields, body } = parseFrontmatter(raw);
    const front = fields as unknown as Partial<SkillFrontmatter>;
    if (!front.name || !front.description) {
      // Malformed skill — skip silently (could log later)
      continue;
    }
    if (front.disabled === true) continue;
    const qualifiedName = pluginName ? `${pluginName}:${front.name}` : front.name;
    out.push({
      qualifiedName,
      frontmatter: front as SkillFrontmatter,
      body,
      path: skillPath,
      source,
    });
  }
}

/**
 * Build the system-prompt fragment that lists available skills (name + description).
 * Body text is NOT included here — only when the model actually invokes the skill.
 */
export function buildSkillsDescriptionBlock(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const lines = [
    "## Available skills (call via the Skill tool to load a skill's instructions)",
    '',
  ];
  for (const s of skills) {
    lines.push(`- **${s.qualifiedName}** — ${s.frontmatter.description}`);
  }
  return lines.join('\n');
}
