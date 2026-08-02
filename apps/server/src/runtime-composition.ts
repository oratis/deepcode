import type { Effort, Mode } from '@deepcode/core';
import type { DeepCodeSettings } from '@deepcode/core/config';
import { HookDispatcher } from '@deepcode/core/hooks';
import { loadMemory } from '@deepcode/core/memory';
import { applyStyle, findStyle, loadOutputStyles } from '@deepcode/core/output-styles';
import { buildSkillsDescriptionBlock, loadSkills, makeSkillTool } from '@deepcode/core/skills';
import { BUILTIN_TOOLS, ToolRegistry } from '@deepcode/core/tools';

export const DEFAULT_APP_SERVER_SYSTEM_PROMPT =
  'You are DeepCode, an AI coding assistant powered by DeepSeek. Help the user with their ' +
  'codebase using the available tools. Be concise and accurate. When you modify files, briefly ' +
  'explain what you changed and why.';

export interface RuntimeCompositionOptions {
  cwd: string;
  directory?: string;
  settings: DeepCodeSettings;
  pluginDirs?: string[];
}

export interface RuntimeComposition {
  tools: ToolRegistry;
  hooks: HookDispatcher;
  systemPrompt: string;
  model: string;
  effort: Effort;
  pluginDirs: string[];
}

export function resolveComposedMode(
  requested: Mode,
  modeExplicit: boolean,
  settings: DeepCodeSettings,
): Mode {
  return modeExplicit ? requested : (settings.permissions?.defaultMode ?? requested);
}

/** Compose filesystem-backed instructions and tools inside the trusted host. */
export async function composeRuntime(
  options: RuntimeCompositionOptions,
): Promise<RuntimeComposition> {
  const { cwd, directory, settings } = options;
  const pluginDirs = options.pluginDirs ?? [];
  const [memory, skills, styles] = await Promise.all([
    loadMemory({
      cwd,
      directory,
      maxBytes: (settings.memoryLoadCapKB ?? 100) * 1024,
    }),
    loadSkills({
      cwd,
      directory,
      pluginDirs,
      overrides: settings.skillOverrides,
    }),
    loadOutputStyles({ cwd, directory }),
  ]);

  const tools = new ToolRegistry(BUILTIN_TOOLS);
  if (skills.length > 0) tools.register(makeSkillTool(skills));

  let systemPrompt = DEFAULT_APP_SERVER_SYSTEM_PROMPT;
  if (memory.text) systemPrompt += `\n\n${memory.text}`;
  const skillsBlock = buildSkillsDescriptionBlock(skills);
  if (skillsBlock) systemPrompt += `\n\n${skillsBlock}`;
  systemPrompt = applyStyle(systemPrompt, findStyle(styles, settings.outputStyle ?? 'default'));

  return {
    tools,
    hooks: new HookDispatcher({
      hooks: settings.hooks,
      disableAllHooks: settings.disableAllHooks,
      allowedHttpHookUrls: settings.allowedHttpHookUrls,
    }),
    systemPrompt,
    model: settings.model ?? 'deepseek-chat',
    effort: settings.effortLevel ?? 'medium',
    pluginDirs,
  };
}
