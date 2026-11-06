import type { ToolHandler } from '../types.js';
import type { Skill } from './loader.js';
/**
 * Build a Skill tool bound to a specific skill registry.
 *
 * Why a factory: ToolHandler.execute() is closed over the skills list at the
 * time of dispatch. Agent loop owners construct this tool with the loaded
 * skills snapshot for the current session.
 */
export declare function makeSkillTool(skills: Skill[]): ToolHandler;
//# sourceMappingURL=tool.d.ts.map