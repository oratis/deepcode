// `deepcode plugins list` + `deepcode skills list` — surface installed plugins
// and loaded skills (the same discovery the agent uses), with a --json mode for
// scripting and the desktop app.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13 (skills) / §3.14 (plugins)

import { discoverPlugins, loadSettings, loadSkills } from '@deepcode/core';
import type { Writable } from 'node:stream';
import { resolveBuiltinSkillsDir } from './builtin-skills.js';

export interface ListCmdDeps {
  cwd: string;
  home?: string;
  output?: Writable;
  errOutput?: Writable;
  /** Emit machine-readable JSON instead of the human table. */
  json?: boolean;
}

interface PluginRow {
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  path: string;
}
interface SkillRow {
  name: string;
  description?: string;
  source: string;
  path: string;
}

export interface PluginsListing {
  rows: PluginRow[];
  /** Installed-but-not-loaded plugins (untrusted or hash-drift), as messages. */
  issues: string[];
}

export async function listPlugins(deps: ListCmdDeps): Promise<PluginsListing> {
  const settings = await loadSettings({ cwd: deps.cwd, home: deps.home });
  const disabled = new Set(settings.merged.disabledPlugins ?? []);
  // discoverPlugins only returns trusted + hash-matched plugins (what the agent
  // actually loads); everything else on disk surfaces in hashMismatches.
  const { plugins, hashMismatches } = await discoverPlugins({ home: deps.home });
  const rows = plugins.map((p) => ({
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    enabled: !disabled.has(p.manifest.name),
    path: p.path,
  }));
  return { rows, issues: hashMismatches };
}

export async function listSkills(deps: ListCmdDeps): Promise<SkillRow[]> {
  const builtinDir = await resolveBuiltinSkillsDir();
  const settings = await loadSettings({ cwd: deps.cwd, home: deps.home });
  const skills = await loadSkills({
    cwd: deps.cwd,
    home: deps.home,
    builtinDir,
    overrides: settings.merged.skillOverrides,
  });
  return skills.map((s) => ({
    name: s.qualifiedName,
    description: s.frontmatter.description,
    source: s.source,
    path: s.path,
  }));
}

export async function runPluginsCommand(sub: string[], deps: ListCmdDeps): Promise<number> {
  const out = deps.output ?? process.stdout;
  if (sub[0] && sub[0] !== 'list') {
    out.write('Usage: deepcode plugins list [--json]\n');
    return 2;
  }
  const { rows, issues } = await listPlugins(deps);
  if (deps.json || sub.includes('--json')) {
    out.write(JSON.stringify({ plugins: rows, issues }, null, 2) + '\n');
    return 0;
  }
  if (rows.length === 0 && issues.length === 0) {
    out.write('No plugins installed (~/.deepcode/plugins).\n');
    return 0;
  }
  for (const p of rows) {
    out.write(
      `${p.name}@${p.version}${p.enabled ? '' : ' (disabled)'}` +
        (p.description ? `  — ${p.description}` : '') +
        `\n`,
    );
  }
  if (issues.length > 0) {
    out.write(`\nNot loaded (run \`deepcode\` to trust on first use):\n`);
    for (const i of issues) out.write(`  ⚠ ${i}\n`);
  }
  return 0;
}

export async function runSkillsCommand(sub: string[], deps: ListCmdDeps): Promise<number> {
  const out = deps.output ?? process.stdout;
  if (sub[0] && sub[0] !== 'list') {
    out.write('Usage: deepcode skills list [--json]\n');
    return 2;
  }
  const rows = await listSkills(deps);
  if (deps.json || sub.includes('--json')) {
    out.write(JSON.stringify(rows, null, 2) + '\n');
    return 0;
  }
  if (rows.length === 0) {
    out.write('No skills found (built-in, ~/.deepcode/skills, or .deepcode/skills).\n');
    return 0;
  }
  for (const s of rows) {
    out.write(`${s.name}  [${s.source}]` + (s.description ? `  — ${s.description}` : '') + `\n`);
  }
  return 0;
}
