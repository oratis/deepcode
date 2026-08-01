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

export { validateSettingsShallow } from './validation.js';
