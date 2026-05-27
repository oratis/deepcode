// Skills subsystem entry — SKILL.md frontmatter loading + system-prompt builder + Skill tool.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13
// Milestone: M4 + M5 (Skill tool)

export {
  loadSkills,
  buildSkillsDescriptionBlock,
  type Skill,
  type SkillFrontmatter,
  type LoadSkillsOpts,
} from './loader.js';

export { parseFrontmatter, parseSimpleYaml, type Frontmatter } from './frontmatter.js';

export { makeSkillTool } from './tool.js';
