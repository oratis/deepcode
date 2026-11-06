// Skills loader — scans the three layers and produces a registry.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13
//
// Layout per skill:
//   <root>/<name>/SKILL.md   (frontmatter + body)
//   <root>/<name>/<asset.ts> (optional helper files)
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
export async function loadSkills(opts) {
    const home = opts.home ?? homedir();
    const directory = opts.directory ?? join(home, '.deepcode');
    const out = [];
    // 1. Built-in skills (shipped with DeepCode)
    if (opts.builtinDir) {
        await loadFromDir(opts.builtinDir, 'builtin', out);
    }
    // 2. User-level — DeepCode's own first, so it wins a name collision, then a
    //    Claude Code user's ~/.claude/skills read in place rather than moved.
    await loadFromDir(join(directory, 'skills'), 'user', out);
    if (!opts.directory) {
        await loadFromDir(join(home, '.claude', 'skills'), 'user', out);
    }
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
        const skillDir = join(root, entry);
        let stat;
        try {
            stat = await fs.stat(skillDir);
        }
        catch {
            continue;
        }
        if (!stat.isDirectory())
            continue;
        const skillPath = join(skillDir, 'SKILL.md');
        let raw;
        try {
            raw = await fs.readFile(skillPath, 'utf8');
        }
        catch {
            continue;
        }
        const { fields, body } = parseFrontmatter(raw);
        const front = fields;
        if (!front.name || !front.description) {
            // Malformed skill — skip silently (could log later)
            continue;
        }
        if (front.disabled === true)
            continue;
        const qualifiedName = pluginName ? `${pluginName}:${front.name}` : front.name;
        // First definition of a name wins. Callers load in precedence order, so a
        // DeepCode skill shadows the Claude Code skill it was derived from instead
        // of both being listed to the model.
        if (out.some((skill) => skill.qualifiedName === qualifiedName))
            continue;
        out.push({
            qualifiedName,
            frontmatter: front,
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
export function buildSkillsDescriptionBlock(skills) {
    if (skills.length === 0)
        return '';
    const lines = [
        "## Available skills (call via the Skill tool to load a skill's instructions)",
        '',
    ];
    for (const s of skills) {
        lines.push(`- **${s.qualifiedName}** — ${s.frontmatter.description}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=loader.js.map