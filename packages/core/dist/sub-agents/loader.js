// Sub-agents loader — .deepcode/agents/*.md files with YAML frontmatter.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13a
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter } from '../skills/frontmatter.js';
export async function loadSubAgents(opts) {
    const home = opts.home ?? homedir();
    const out = [];
    await loadFromDir(join(home, '.deepcode', 'agents'), 'user', out);
    // A Claude Code user's agents, read in place rather than moved.
    await loadFromDir(join(home, '.claude', 'agents'), 'user', out);
    await loadFromDir(opts.projectDirOverride ?? join(opts.cwd, '.deepcode', 'agents'), 'project', out);
    for (const pluginDir of opts.pluginDirs ?? []) {
        const pluginName = pluginDir.split('/').filter(Boolean).pop() ?? 'plugin';
        await loadFromDir(join(pluginDir, 'agents'), 'plugin', out, pluginName);
    }
    return out;
}
async function loadFromDir(root, source, out, pluginName) {
    let entries;
    try {
        entries = await fs.readdir(root);
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return;
        throw err;
    }
    for (const entry of entries) {
        if (!entry.endsWith('.md'))
            continue;
        const path = join(root, entry);
        const raw = await fs.readFile(path, 'utf8');
        const { fields, body } = parseFrontmatter(raw);
        const front = fields;
        if (!front.name || !front.description)
            continue;
        const qualifiedName = pluginName ? `${pluginName}:${front.name}` : front.name;
        // First definition wins, matching findAgent()'s .find(). Callers load in
        // precedence order, so a DeepCode agent shadows a same-named Claude Code
        // one rather than the list carrying both.
        if (out.some((agent) => agent.qualifiedName === qualifiedName))
            continue;
        out.push({
            qualifiedName,
            frontmatter: front,
            body,
            path,
            source,
        });
    }
}
/** Lookup helper. */
export function findSubAgent(agents, name) {
    return agents.find((a) => a.qualifiedName === name);
}
//# sourceMappingURL=loader.js.map