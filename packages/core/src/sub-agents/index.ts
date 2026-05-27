// Sub-agents subsystem entry — `.deepcode/agents/*.md` files.
// Spec: docs/DEVELOPMENT_PLAN.md §3.13a
// Milestone: M4

export {
  loadSubAgents,
  findSubAgent,
  type SubAgent,
  type SubAgentFrontmatter,
  type LoadSubAgentsOpts,
} from './loader.js';
