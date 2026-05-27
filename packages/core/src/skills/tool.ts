// Skill tool — lets the agent invoke a skill by name. When invoked, the
// agent's next turn gets the skill's body injected as additional system
// context (via the tool_result).
// Spec: docs/DEVELOPMENT_PLAN.md §3.13 ("Triggered via the Skill tool")

import type { ToolContext, ToolHandler, ToolResult } from '../types.js';
import type { Skill } from './loader.js';

/**
 * Build a Skill tool bound to a specific skill registry.
 *
 * Why a factory: ToolHandler.execute() is closed over the skills list at the
 * time of dispatch. Agent loop owners construct this tool with the loaded
 * skills snapshot for the current session.
 */
export function makeSkillTool(skills: Skill[]): ToolHandler {
  const byName = new Map<string, Skill>();
  for (const s of skills) byName.set(s.qualifiedName, s);

  return {
    name: 'Skill',
    definition: {
      name: 'Skill',
      description:
        "Load a skill by its qualified name. The skill's instructions become part of the system context for subsequent turns. Use the auto-triggered skill matching the user's request.",
      inputSchema: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            description: 'Qualified skill name (e.g. "code-review" or "plugin:foo").',
          },
          args: {
            type: 'string',
            description: 'Optional argument string to pass to the skill.',
          },
        },
        required: ['skill'],
      },
    },
    async execute(rawInput: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const input = rawInput as { skill?: string; args?: string };
      if (!input.skill || typeof input.skill !== 'string') {
        return { content: 'Error: skill name required.', isError: true };
      }
      const skill = byName.get(input.skill);
      if (!skill) {
        const known = [...byName.keys()].slice(0, 10).join(', ') || '(none)';
        return {
          content: `Error: skill "${input.skill}" not found. Known: ${known}`,
          isError: true,
        };
      }
      const body = skill.body.trim();
      const argsNote = input.args ? `\n\nUser-supplied args: ${input.args}` : '';
      return {
        content: `[Skill loaded: ${skill.qualifiedName}]\n\n${body}${argsNote}`,
        data: { skillName: skill.qualifiedName, path: skill.path },
      };
    },
  };
}
