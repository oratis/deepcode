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

export type SettingsLayerName = 'user' | 'project' | 'local' | 'override';

export interface SettingsValueSource {
  layer: SettingsLayerName;
  path: string;
}

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
  /** Winning source for each leaf setting, keyed by RFC 6901 JSON pointer. */
  provenance: Record<string, SettingsValueSource>;
}

export interface LoadSettingsOpts {
  cwd: string;
  /** Override $HOME for tests. */
  home?: string;
  /** Direct DeepCode data directory override (contains settings.json). */
  directory?: string;
  /** `--settings <file>`: a settings file that wins over all discovered layers. */
  settingsPath?: string;
}

export function settingsPaths(opts: LoadSettingsOpts): LoadedSettings['sources'] {
  const directory = opts.directory ?? join(opts.home ?? homedir(), '.deepcode');
  return {
    userPath: join(directory, 'settings.json'),
    projectPath: resolve(opts.cwd, '.deepcode', 'settings.json'),
    localPath: resolve(opts.cwd, '.deepcode', 'settings.local.json'),
  };
}

/**
 * Where the user layer comes from when DeepCode has no settings of its own.
 *
 * A Claude Code user's `~/.claude/settings.json` is read in place rather than
 * requiring `mv ~/.claude/settings.json ~/.deepcode/settings.json`. It is a
 * *fallback*, not an extra layer: the moment `~/.deepcode/settings.json`
 * exists it wins outright, so provenance keeps naming one real file and the
 * trust gate keeps seeing exactly the layers it already knows about.
 *
 * User-level only. A project's `.claude/settings.json` is not read: project
 * settings pass through the directory-trust gate, and quietly widening what
 * that gate covers is not a change to make in passing.
 */
export async function resolveUserSettingsPath(opts: LoadSettingsOpts): Promise<string> {
  const preferred = settingsPaths(opts).userPath;
  if (opts.directory) return preferred; // explicit data dir — no fallback
  try {
    await fs.access(preferred);
    return preferred;
  } catch {
    const claudePath = join(opts.home ?? homedir(), '.claude', 'settings.json');
    try {
      await fs.access(claudePath);
      return claudePath;
    } catch {
      return preferred;
    }
  }
}

async function readJson(path: string): Promise<DeepCodeSettings | undefined> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return parseSettings(raw, path);
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
    return parseSettings(raw, path);
  } catch (err) {
    throw new Error(`--settings: cannot load ${path}: ${(err as Error).message}`);
  }
}

export async function loadSettings(opts: LoadSettingsOpts): Promise<LoadedSettings> {
  const sources = { ...settingsPaths(opts), userPath: await resolveUserSettingsPath(opts) };
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
  const resolvedSources = { ...sources, overridePath: opts.settingsPath };
  return {
    merged,
    layers: { user, project, local, override },
    sources: resolvedSources,
    provenance: settingsProvenance(
      { user, project, local, override },
      {
        user: resolvedSources.userPath,
        project: resolvedSources.projectPath,
        local: resolvedSources.localPath,
        override: resolvedSources.overridePath,
      },
    ),
  };
}

function parseSettings(raw: string, path: string): DeepCodeSettings {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error(`Settings in ${path} must be a JSON object`);
  assertSafeValue(parsed, '', path);
  return parsed as DeepCodeSettings;
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function assertSafeValue(value: unknown, pointer: string, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeValue(entry, `${pointer}/${index}`, path));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) {
      throw new Error(`Unsafe settings key ${pointer}/${escapePointer(key)} in ${path}`);
    }
    assertSafeValue(entry, `${pointer}/${escapePointer(key)}`, path);
  }
}

function settingsProvenance(
  layers: LoadedSettings['layers'],
  paths: Record<SettingsLayerName, string | undefined>,
): Record<string, SettingsValueSource> {
  const provenance: Record<string, SettingsValueSource> = {};
  for (const layer of ['user', 'project', 'local', 'override'] as const) {
    const settings = layers[layer];
    const path = paths[layer];
    if (settings && path)
      collectProvenance(settings as Record<string, unknown>, '', layer, path, provenance);
  }
  return provenance;
}

function collectProvenance(
  value: Record<string, unknown>,
  pointer: string,
  layer: SettingsLayerName,
  path: string,
  output: Record<string, SettingsValueSource>,
): void {
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    const child = `${pointer}/${escapePointer(key)}`;
    if (isRecord(entry) && Object.keys(entry).length > 0) {
      collectProvenance(entry, child, layer, path, output);
    } else {
      output[child] = { layer, path };
    }
  }
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep-merge: objects merged recursively; arrays/scalars in later overwrite earlier.
 * (Arrays are NOT concatenated — settings semantics are "later replaces earlier".)
 */
export function deepMerge<T extends Record<string, unknown>>(a: T, b: T): T {
  assertSafeValue(a, '', 'settings merge input');
  assertSafeValue(b, '', 'settings merge input');
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
