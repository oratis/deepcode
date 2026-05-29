// Settings JSON schema — exposes the schema for IDE autocomplete.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9
//
// The schema itself lives in packages/core/schemas/settings.schema.json
// (deliberately outside src/ so it's published as a static asset and
// referenced via `$schema` from user settings.json files).
//
// At runtime we expose `settingsSchemaJson()` which reads + returns the
// schema body — used by the `/doctor` command and the desktop client's
// Settings screen for validation.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Schema file is at <pkgRoot>/schemas/settings.schema.json
// From dist/config/schema.js the relative path is ../../schemas/...
// From src/config/schema.ts the relative path is ../../schemas/... too.
const SCHEMA_PATH = join(__dirname, '..', '..', 'schemas', 'settings.schema.json');

let cached: string | undefined;

export async function settingsSchemaJson(): Promise<string> {
  if (cached === undefined) {
    cached = await readFile(SCHEMA_PATH, 'utf8');
  }
  return cached;
}

export async function settingsSchemaObject(): Promise<Record<string, unknown>> {
  const raw = await settingsSchemaJson();
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Lightweight validation: checks required-ish fields + enum membership for
 * the fields users most often misspell. Returns an array of error strings;
 * empty array = valid (or at least no detected issues).
 *
 * This is NOT a full draft-07 validator; for that, route through an
 * external library. The goal here is fast feedback in `/doctor` without
 * dragging ajv into the runtime.
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
    for (const k of Object.keys(hooks)) {
      if (!validEvents.includes(k)) {
        errors.push(`hooks.${k} is not a known event (valid: ${validEvents.join(', ')})`);
      }
    }
  }

  return errors;
}
