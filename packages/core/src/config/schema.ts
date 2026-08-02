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

// CJS sidecars cannot resolve package-relative assets through import.meta.url,
// and packaged clients do not ship the core workspace tree. Their esbuild
// entrypoints replace this constant with the schema contents. Normal ESM
// package consumers take the file-backed fallback below.
declare const __DEEPCODE_SETTINGS_SCHEMA__: string | undefined;
const EMBEDDED_SCHEMA =
  typeof __DEEPCODE_SETTINGS_SCHEMA__ === 'string' ? __DEEPCODE_SETTINGS_SCHEMA__ : undefined;

let cached: string | undefined;

export async function settingsSchemaJson(): Promise<string> {
  if (cached === undefined) {
    cached = EMBEDDED_SCHEMA ?? (await readFile(schemaPath(), 'utf8'));
  }
  return cached;
}

function schemaPath(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  // From both src/config/schema.ts and dist/config/schema.js.
  return join(moduleDirectory, '..', '..', 'schemas', 'settings.schema.json');
}

export async function settingsSchemaObject(): Promise<Record<string, unknown>> {
  const raw = await settingsSchemaJson();
  return JSON.parse(raw) as Record<string, unknown>;
}

export { validateSettingsShallow } from './validation.js';
