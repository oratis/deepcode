// Type-safe wrapper over Tauri's `invoke()` for the DeepCode renderer.
// Replaces the previous Electron contextBridge surface (window.deepcode.*).
//
// Each function maps to a #[tauri::command] in apps/desktop/src-tauri/src/commands.rs.

import { invoke } from '@tauri-apps/api/core';

export interface AppInfo {
  version: string;
  platform: string;
  home_dir: string | null;
}

export interface Credentials {
  apiKey?: string;
  authToken?: string;
  baseURL?: string;
}

export interface SessionMeta {
  id: string;
  path: string;
  size_bytes: number;
  updated_at_secs: number;
}

export async function getAppInfo(): Promise<AppInfo> {
  return invoke('get_app_info');
}

export async function readCredentials(): Promise<Credentials> {
  // Backend uses snake_case Rust fields; convert.
  const raw = (await invoke('read_credentials')) as {
    api_key?: string;
    auth_token?: string;
    base_url?: string;
  };
  return {
    apiKey: raw.api_key,
    authToken: raw.auth_token,
    baseURL: raw.base_url,
  };
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  await invoke('save_credentials', {
    creds: {
      api_key: creds.apiKey,
      auth_token: creds.authToken,
      base_url: creds.baseURL,
    },
  });
}

export async function loadSettingsFile(): Promise<Record<string, unknown>> {
  return (await invoke('load_settings_file')) as Record<string, unknown>;
}

export async function saveSettingsFile(value: Record<string, unknown>): Promise<void> {
  await invoke('save_settings_file', { value });
}

export async function getSettingsPath(): Promise<string | null> {
  return (await invoke('get_settings_path')) as string | null;
}

/** Append a permissions matcher to ~/.deepcode/settings.json. Idempotent. */
export async function appendAllowMatcher(matcher: string): Promise<void> {
  await invoke('append_allow_matcher', { matcher });
}

export interface KeybindingsConfigOnDisk {
  enabled?: boolean;
  vim?: boolean;
  bindings?: Array<{
    key: string;
    action: string;
    when?: 'NORMAL' | 'INSERT' | 'VISUAL';
    description?: string;
  }>;
}

/** Read ~/.deepcode/keybindings.json. Returns {} if absent. */
export async function loadKeybindings(): Promise<KeybindingsConfigOnDisk> {
  return (await invoke('load_keybindings')) as KeybindingsConfigOnDisk;
}

/** Write ~/.deepcode/keybindings.json. */
export async function saveKeybindings(value: KeybindingsConfigOnDisk): Promise<void> {
  await invoke('save_keybindings', { value });
}

export async function listSessions(): Promise<SessionMeta[]> {
  return (await invoke('list_sessions')) as SessionMeta[];
}

export async function cliPath(): Promise<string | null> {
  return (await invoke('cli_path')) as string | null;
}

/** Open a URL in the user's default browser. */
export async function openUrl(url: string): Promise<void> {
  const { openUrl: openerOpen } = await import('@tauri-apps/plugin-opener');
  await openerOpen(url);
}
