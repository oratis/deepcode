// Project context — the absolute path to the currently-active project
// folder. Persisted to settings.json#projectPath so the choice survives
// restart. Driving cwd for every agent turn + tool call.

import { loadSettingsFile, saveSettingsFile } from './tauri-api.js';

const KEY = 'projectPath';

export async function loadProjectPath(): Promise<string | undefined> {
  try {
    const s = (await loadSettingsFile()) as Record<string, unknown>;
    const v = s[KEY];
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

export async function saveProjectPath(path: string): Promise<void> {
  try {
    const s = (await loadSettingsFile()) as Record<string, unknown>;
    await saveSettingsFile({ ...s, [KEY]: path });
  } catch (err) {
    console.warn('Failed to persist project path:', err);
  }
}

/** Display the last segment of an absolute path (project name). */
export function projectName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
