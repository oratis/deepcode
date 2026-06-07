// settings.json three-layer loader.
// Spec: docs/DEVELOPMENT_PLAN.md §3.9
// Layers (highest priority last):
//   1. ~/.deepcode/settings.json                              user-level
//   2. <project>/.deepcode/settings.json                      project-level
//   3. <project>/.deepcode/settings.local.json                local override
// (managed/MDM policy layer is NOT implemented — v1 non-goal per §0.2)

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DeepCodeSettings } from './types.js';

export interface LoadedSettings {
  merged: DeepCodeSettings;
  layers: {
    user?: DeepCodeSettings;
    project?: DeepCodeSettings;
    local?: DeepCodeSettings;
    /** `--settings <file>` override — highest precedence, treated as trusted. */
    override?: DeepCodeSettings;
  };
  sources: {
    userPath: string;
    projectPath: string;
    localPath: string;
    overridePath?: string;
  };
}

export interface LoadSettingsOpts {
  cwd: string;
  /** Override $HOME for tests. */
  home?: string;
  /** `--settings <file>`: a settings file that wins over all discovered layers. */
  settingsPath?: string;
}

export function settingsPaths(opts: LoadSettingsOpts): LoadedSettings['sources'] {
  const home = opts.home ?? homedir();
  return {
    userPath: join(home, '.deepcode', 'settings.json'),
    projectPath: resolve(opts.cwd, '.deepcode', 'settings.json'),
    localPath: resolve(opts.cwd, '.deepcode', 'settings.local.json'),
  };
}

async function readJson(path: string): Promise<DeepCodeSettings | undefined> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw) as DeepCodeSettings;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
  }
}

/** Like readJson but the file is REQUIRED (explicit --settings path): a missing
 *  or unparseable file is a hard error, not a silent skip. */
async function readJsonRequired(path: string): Promise<DeepCodeSettings> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw) as DeepCodeSettings;
  } catch (err) {
    throw new Error(`--settings: cannot load ${path}: ${(err as Error).message}`);
  }
}

export async function loadSettings(opts: LoadSettingsOpts): Promise<LoadedSettings> {
  const sources = settingsPaths(opts);
  const [user, project, local, override] = await Promise.all([
    readJson(sources.userPath),
    readJson(sources.projectPath),
    readJson(sources.localPath),
    opts.settingsPath ? readJsonRequired(opts.settingsPath) : Promise.resolve(undefined),
  ]);
  let merged = deepMerge(
    deepMerge({}, (user ?? {}) as Record<string, unknown>),
    deepMerge((project ?? {}) as Record<string, unknown>, (local ?? {}) as Record<string, unknown>),
  ) as DeepCodeSettings;
  // --settings wins over everything discovered on disk.
  if (override) {
    merged = deepMerge(
      merged as Record<string, unknown>,
      override as Record<string, unknown>,
    ) as DeepCodeSettings;
  }
  return {
    merged,
    layers: { user, project, local, override },
    sources: { ...sources, overridePath: opts.settingsPath },
  };
}

/**
 * Deep-merge: objects merged recursively; arrays/scalars in later overwrite earlier.
 * (Arrays are NOT concatenated — settings semantics are "later replaces earlier".)
 */
export function deepMerge<T extends Record<string, unknown>>(a: T, b: T): T {
  const out: Record<string, unknown> = { ...a };
  for (const key of Object.keys(b)) {
    const av = (a as Record<string, unknown>)[key];
    const bv = (b as Record<string, unknown>)[key];
    if (
      av &&
      bv &&
      typeof av === 'object' &&
      typeof bv === 'object' &&
      !Array.isArray(av) &&
      !Array.isArray(bv)
    ) {
      out[key] = deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>);
    } else if (bv !== undefined) {
      out[key] = bv;
    }
  }
  return out as T;
}

export async function writeSettings(path: string, settings: DeepCodeSettings): Promise<void> {
  const json = JSON.stringify(settings, null, 2) + '\n';
  await fs.mkdir(resolveDir(path), { recursive: true });
  await fs.writeFile(path, json, 'utf8');
}

/**
 * Append a single matcher to `permissions.allow[]` inside the settings file
 * at `path` (creating the file if it doesn't exist). Idempotent — does
 * nothing if the matcher is already present.
 *
 * Used by the approval flow: when the user clicks "Always allow", the host
 * calls this against the project-local settings.local.json so the rule
 * survives across sessions.
 */
export async function appendAllowMatcher(path: string, matcher: string): Promise<void> {
  const trimmed = matcher.trim();
  if (!trimmed) return;
  const existing = (await readJson(path)) ?? ({} as DeepCodeSettings);
  const permissions = (existing.permissions ?? {}) as {
    allow?: string[];
    deny?: string[];
    ask?: string[];
  };
  const allow = Array.isArray(permissions.allow) ? [...permissions.allow] : [];
  if (allow.includes(trimmed)) return;
  allow.push(trimmed);
  const next: DeepCodeSettings = {
    ...existing,
    permissions: { ...permissions, allow },
  };
  await writeSettings(path, next);
}

function resolveDir(p: string): string {
  return p.slice(0, p.lastIndexOf('/'));
}
