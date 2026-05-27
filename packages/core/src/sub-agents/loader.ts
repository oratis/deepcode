// Sub-agents loader — .deepcode/agents/*.md files with YAML frontmatter.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13a

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter } from '../skills/frontmatter.js';

export interface SubAgentFrontmatter {
  name: string;
  description: string;
  /** Tool whitelist for this sub-agent. */
  tools?: string[];
  /** Model override. */
  model?: string;
  /** Isolation style. */
  isolation?: 'subprocess' | 'worktree' | 'none';
  /** Max turns this sub-agent can use. */
  maxTurns?: number;
}

export interface SubAgent {
  /** `<name>` (user/project) or `<plugin>:<name>`. */
  qualifiedName: string;
  frontmatter: SubAgentFrontmatter;
  /** Markdown body — becomes the sub-agent's system prompt. */
  body: string;
  path: string;
  source: 'user' | 'project' | 'plugin';
}

export interface LoadSubAgentsOpts {
  cwd: string;
  home?: string;
  pluginDirs?: string[];
  /** Override the project-level dir (used by CLI `--agents` flag). */
  projectDirOverride?: string;
}

export async function loadSubAgents(opts: LoadSubAgentsOpts): Promise<SubAgent[]> {
  const home = opts.home ?? homedir();
  const out: SubAgent[] = [];
  await loadFromDir(join(home, '.deepcode', 'agents'), 'user', out);
  await loadFromDir(
    opts.projectDirOverride ?? join(opts.cwd, '.deepcode', 'agents'),
    'project',
    out,
  );
  for (const pluginDir of opts.pluginDirs ?? []) {
    const pluginName = pluginDir.split('/').filter(Boolean).pop() ?? 'plugin';
    await loadFromDir(join(pluginDir, 'agents'), 'plugin', out, pluginName);
  }
  return out;
}

async function loadFromDir(
  root: string,
  source: SubAgent['source'],
  out: SubAgent[],
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
    if (!entry.endsWith('.md')) continue;
    const path = join(root, entry);
    const raw = await fs.readFile(path, 'utf8');
    const { fields, body } = parseFrontmatter(raw);
    const front = fields as unknown as Partial<SubAgentFrontmatter>;
    if (!front.name || !front.description) continue;
    const qualifiedName = pluginName ? `${pluginName}:${front.name}` : front.name;
    out.push({
      qualifiedName,
      frontmatter: front as SubAgentFrontmatter,
      body,
      path,
      source,
    });
  }
}

/** Lookup helper. */
export function findSubAgent(agents: SubAgent[], name: string): SubAgent | undefined {
  return agents.find((a) => a.qualifiedName === name);
}
