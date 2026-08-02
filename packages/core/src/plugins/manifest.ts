// Plugin manifest schema + loader.
// Spec: docs/DEVELOPMENT_PLAN.md §3.14 / docs/design/plugin-security.md
//
// M5 ships:
// - Manifest parser (plugin.json schema validation)
// - Local-directory installation flow (deepcode plugin install ./path)
// - Trust-pin via hash (~/.deepcode/plugins-trust.json)
// - Discovery of installed plugins on agent start
//
// Sandbox-subprocess execution is deferred (see plugin-security.md §3.5).
// In M5 plugins still run in-process — DOCUMENTED AS UNSAFE until M5.1.

import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpServerConfig } from '../config/types.js';

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  engines?: { deepcode?: string };
  contributes?: {
    skills?: string[];
    commands?: Array<{ name: string; skill?: string; prompt?: string }>;
    hooks?: Record<string, unknown>;
    mcpServers?: Record<string, unknown>;
    agents?: string[];
    statusLines?: Array<{ name: string; command: string }>;
    modes?: Array<{ name: string; policy: Record<string, unknown> }>;
  };
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory. */
  path: string;
  /** SHA-256 of the manifest + skill files (truncated to 16 hex). */
  sourceHash: string;
  /** Whether the plugin is enabled in settings. */
  enabled: boolean;
}

export interface PluginTrust {
  version: string;
  installedAt: string;
  sourceHash: string;
  /** How this plugin entered the user's trust. */
  trustedBy: 'user' | 'marketplace' | 'official';
  /** Optional marketplace name. */
  marketplaceVerified?: string;
}

export interface TrustState {
  plugins: Record<string, PluginTrust>;
}

export function pluginsDir(home: string, directory?: string): string {
  return join(directory ?? join(home, '.deepcode'), 'plugins');
}

export function trustFilePath(home: string, directory?: string): string {
  return join(directory ?? join(home, '.deepcode'), 'plugins-trust.json');
}

/** Compute a deterministic trust hash over every installed plugin file. */
export async function computeSourceHash(pluginPath: string): Promise<string> {
  const hash = createHash('sha256');
  const files = await pluginFiles(pluginPath);
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(await fs.readFile(join(pluginPath, relativePath)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

async function pluginFiles(root: string, current = root, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await pluginFiles(root, absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Plugin contains unsupported symbolic link: ${relativePath}`);
    }
  }
  return files;
}

export async function readManifest(pluginPath: string): Promise<PluginManifest> {
  const raw = await fs.readFile(join(pluginPath, 'plugin.json'), 'utf8');
  const parsed = JSON.parse(raw) as PluginManifest;
  if (!parsed.name || !parsed.version) {
    throw new Error(
      `${pluginPath}/plugin.json missing required field: ${!parsed.name ? 'name' : 'version'}`,
    );
  }
  return parsed;
}

export async function loadTrustState(home: string, directory?: string): Promise<TrustState> {
  try {
    const raw = await fs.readFile(trustFilePath(home, directory), 'utf8');
    return JSON.parse(raw) as TrustState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { plugins: {} };
    throw err;
  }
}

export async function saveTrustState(
  home: string,
  state: TrustState,
  directory?: string,
): Promise<void> {
  const path = trustFilePath(home, directory);
  await fs.mkdir(directory ?? join(home, '.deepcode'), { recursive: true });
  await fs.writeFile(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export interface InstallOptions {
  sourcePath: string;
  home?: string;
  trustedBy?: PluginTrust['trustedBy'];
}

/**
 * Copy a local plugin into ~/.deepcode/plugins/<name>/ and record trust.
 * Returns the InstalledPlugin on success.
 */
export async function installLocal(opts: InstallOptions): Promise<InstalledPlugin> {
  const home = opts.home ?? homedir();
  const manifest = await readManifest(opts.sourcePath);
  const destDir = join(pluginsDir(home), manifest.name);
  await fs.mkdir(destDir, { recursive: true });
  await copyDirectory(opts.sourcePath, destDir);

  const hash = await computeSourceHash(destDir);
  const state = await loadTrustState(home);
  state.plugins[manifest.name] = {
    version: manifest.version,
    installedAt: new Date().toISOString(),
    sourceHash: hash,
    trustedBy: opts.trustedBy ?? 'user',
  };
  await saveTrustState(home, state);
  return { manifest, path: destDir, sourceHash: hash, enabled: true };
}

export interface DiscoverOptions {
  home?: string;
  /** Direct DeepCode data directory (contains plugins/ and plugins-trust.json). */
  directory?: string;
  /** Plugins disabled in settings (settings.disabledPlugins). */
  disabled?: string[];
}

/**
 * Scan ~/.deepcode/plugins/ for installed plugins and verify hash pinning.
 * Plugins whose hash drifted from the trust manifest are SKIPPED (returned with enabled=false).
 */
export async function discoverPlugins(opts: DiscoverOptions = {}): Promise<{
  plugins: InstalledPlugin[];
  hashMismatches: string[];
}> {
  const home = opts.home ?? homedir();
  const root = pluginsDir(home, opts.directory);
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return { plugins: [], hashMismatches: [] };
    throw err;
  }
  const trust = await loadTrustState(home, opts.directory);
  const out: InstalledPlugin[] = [];
  const hashMismatches: string[] = [];
  const disabled = new Set(opts.disabled ?? []);

  for (const name of entries) {
    if (name.startsWith('.')) continue; // skip .staging etc.
    const pluginPath = join(root, name);
    let manifest;
    try {
      manifest = await readManifest(pluginPath);
    } catch {
      continue;
    }
    let liveHash: string;
    try {
      liveHash = await computeSourceHash(pluginPath);
    } catch (error) {
      hashMismatches.push(`${manifest.name}: source hash failed (${(error as Error).message})`);
      continue;
    }
    const trusted = trust.plugins[manifest.name];
    if (!trusted) {
      // Plugin in dir but never trusted — skip + flag
      hashMismatches.push(`${manifest.name}: not in trust manifest`);
      continue;
    }
    if (trusted.sourceHash !== liveHash) {
      hashMismatches.push(
        `${manifest.name}: hash drift (was ${trusted.sourceHash}, now ${liveHash})`,
      );
      continue;
    }
    out.push({
      manifest,
      path: pluginPath,
      sourceHash: liveHash,
      enabled: !disabled.has(manifest.name),
    });
  }
  return { plugins: out, hashMismatches };
}

/**
 * Collect the live contributions of trusted+enabled plugins for the host to
 * wire in: their directories (for skill / sub-agent / command loaders, which
 * read `<dir>/{skills,agents,commands}`) and their contributed `mcpServers`.
 * Hooks are merged separately by wirePlugins (it needs the live dispatcher).
 */
export async function collectPluginContributions(
  opts: { home?: string; directory?: string; disabled?: string[] } = {},
): Promise<{ dirs: string[]; mcpServers: Record<string, McpServerConfig> }> {
  const { plugins } = await discoverPlugins({
    home: opts.home,
    directory: opts.directory,
    disabled: opts.disabled,
  });
  const enabled = plugins.filter((p) => p.enabled);
  const dirs = enabled.map((p) => p.path);
  const mcpServers: Record<string, McpServerConfig> = {};
  for (const p of enabled) {
    const contributed = p.manifest.contributes?.mcpServers;
    if (contributed) Object.assign(mcpServers, contributed as Record<string, McpServerConfig>);
  }
  return { dirs, mcpServers };
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
