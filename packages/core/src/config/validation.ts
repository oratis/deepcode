/**
 * Lightweight validation for diagnostics. Kept independent of the static
 * schema reader so CJS sidecar bundles do not need `import.meta.url`.
 */
export function validateSettingsShallow(settings: Record<string, unknown>): string[] {
  const errors: string[] = [];

  const modelEnum = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-pro'];
  if (settings['model'] !== undefined && !modelEnum.includes(settings['model'] as string)) {
    errors.push(`settings.model "${settings['model']}" not in ${modelEnum.join(' | ')}`);
  }

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
