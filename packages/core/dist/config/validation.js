/**
 * Lightweight validation for diagnostics. Kept independent of the static
 * schema reader so CJS sidecar bundles do not need `import.meta.url`.
 */
export function validateSettingsShallow(settings) {
    const errors = [];
    const modelEnum = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-pro'];
    if (settings['model'] !== undefined && !modelEnum.includes(settings['model'])) {
        errors.push(`settings.model "${settings['model']}" not in ${modelEnum.join(' | ')}`);
    }
    const effortEnum = ['low', 'medium', 'high', 'xhigh', 'max'];
    if (settings['effortLevel'] !== undefined &&
        !effortEnum.includes(settings['effortLevel'])) {
        errors.push(`settings.effortLevel "${settings['effortLevel']}" not in ${effortEnum.join(' | ')}`);
    }
    const modeEnum = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];
    const perm = settings['permissions'];
    if (perm?.defaultMode && !modeEnum.includes(perm.defaultMode)) {
        errors.push(`permissions.defaultMode "${perm.defaultMode}" not in ${modeEnum.join(' | ')}`);
    }
    const hooks = settings['hooks'];
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
    const voice = settings['voice'];
    if (voice?.provider && !voiceProviderEnum.includes(voice.provider)) {
        errors.push(`voice.provider "${voice.provider}" not in ${voiceProviderEnum.join(' | ')}`);
    }
    return errors;
}
//# sourceMappingURL=validation.js.map