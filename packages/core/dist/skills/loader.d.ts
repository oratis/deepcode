import type { Effort } from '../types.js';
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
    /** Direct DeepCode data directory (contains skills/). */
    directory?: string;
    /** Optional list of plugin directories (M5+). */
    pluginDirs?: string[];
    /** Skill name → { disabled: true } overrides from settings.json. */
    overrides?: Record<string, {
        disabled?: boolean;
    }>;
    /** Built-in skill dir (for tests). */
    builtinDir?: string;
}
export declare function loadSkills(opts: LoadSkillsOpts): Promise<Skill[]>;
/**
 * Build the system-prompt fragment that lists available skills (name + description).
 * Body text is NOT included here — only when the model actually invokes the skill.
 */
export declare function buildSkillsDescriptionBlock(skills: Skill[]): string;
//# sourceMappingURL=loader.d.ts.map