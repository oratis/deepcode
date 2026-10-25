import { validModelId } from '../providers/catalog.js';

/**
 * Lightweight validation for diagnostics. Kept independent of the static
 * schema reader so CJS sidecar bundles do not need `import.meta.url`.
 */
export function validateSettingsShallow(settings: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (settings.model !== undefined && !validModelId(settings.model)) {
    errors.push('settings.model must be a non-empty model identifier');
  }
  if (
    settings.provider !== undefined &&
    !['deepseek', 'kimi', 'glm'].includes(String(settings.provider))
  ) {
    errors.push('settings.provider must be deepseek, kimi or glm');
  }

  if (settings.engine !== undefined && !['native', 'claude-sdk'].includes(String(settings.engine)))
    errors.push('settings.engine must be native or claude-sdk');

  const effortEnum = ['low', 'medium', 'high', 'xhigh', 'max'];
  if (
    settings['effortLevel'] !== undefined &&
    !effortEnum.includes(settings['effortLevel'] as string)
  ) {
    errors.push(
      `settings.effortLevel "${settings['effortLevel']}" not in ${effortEnum.join(' | ')}`,
    );
  }

  const modeEnum = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];
  const perm = settings['permissions'] as { defaultMode?: string } | undefined;
  if (perm?.defaultMode && !modeEnum.includes(perm.defaultMode)) {
    errors.push(`permissions.defaultMode "${perm.defaultMode}" not in ${modeEnum.join(' | ')}`);
  }

  const hooks = settings['hooks'] as Record<string, unknown> | undefined;
  if (hooks) {
    const validEvents = [
      'PreToolUse',
      'PostToolUse',
      'Stop',
      'SubagentStop',
      'PreCompact',
      'PostCompact',
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'Notification',
    ];
    for (const key of Object.keys(hooks)) {
      if (!validEvents.includes(key)) {
        errors.push(`hooks.${key} is not a known event (valid: ${validEvents.join(', ')})`);
      }
    }
  }

  const voiceProviderEnum = ['whisper.cpp', 'stub'];
  const voice = settings['voice'] as { provider?: string } | undefined;
  if (voice?.provider && !voiceProviderEnum.includes(voice.provider)) {
    errors.push(`voice.provider "${voice.provider}" not in ${voiceProviderEnum.join(' | ')}`);
  }

  return errors;
}
