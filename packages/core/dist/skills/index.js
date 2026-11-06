// Skills subsystem entry — SKILL.md frontmatter loading + system-prompt builder + Skill tool.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13
// Milestone: M4 + M5 (Skill tool)
export { loadSkills, buildSkillsDescriptionBlock, } from './loader.js';
export { parseFrontmatter, parseSimpleYaml } from './frontmatter.js';
export { makeSkillTool } from './tool.js';
export { distillSkill, redact as redactSkillText, sanitizeName as sanitizeSkillName, } from './distill.js';
//# sourceMappingURL=index.js.map