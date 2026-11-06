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
const EMBEDDED_SCHEMA = typeof __DEEPCODE_SETTINGS_SCHEMA__ === 'string' ? __DEEPCODE_SETTINGS_SCHEMA__ : undefined;
let cached;
export async function settingsSchemaJson() {
    if (cached === undefined) {
        cached = EMBEDDED_SCHEMA ?? (await readFile(schemaPath(), 'utf8'));
    }
    return cached;
}
function schemaPath() {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    // From both src/config/schema.ts and dist/config/schema.js.
    return join(moduleDirectory, '..', '..', 'schemas', 'settings.schema.json');
}
export async function settingsSchemaObject() {
    const raw = await settingsSchemaJson();
    return JSON.parse(raw);
}
export { validateSettingsShallow } from './validation.js';
//# sourceMappingURL=schema.js.map