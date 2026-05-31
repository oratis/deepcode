// Contract tests for the renderer↔Rust IPC boundary (tauri-api.ts).
//
// These lock the command names and the snake_case↔camelCase mapping that the
// Rust #[tauri::command] handlers expect. HANDOFF §8a: casing mismatches across
// this boundary shipped real bugs twice. The Rust side is guarded by
// src-tauri/src/tools.rs casing_tests; this guards the TS side.
//
// `invoke` is mocked so no Tauri runtime is needed.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  appendAllowMatcher,
  getAppInfo,
  listPlugins,
  listSkills,
  loadSettingsFile,
  readCredentials,
  saveCredentials,
  saveSettingsFile,
  sessionAppend,
  sessionCreate,
} from './tauri-api.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe('readCredentials', () => {
  it('maps Rust snake_case → renderer camelCase (the §8a direction)', async () => {
    invokeMock.mockResolvedValue({
      api_key: 'sk-123',
      auth_token: 'tok-9',
      base_url: 'https://api.deepseek.com/v1',
    });
    const creds = await readCredentials();
    expect(invokeMock).toHaveBeenCalledWith('read_credentials');
    expect(creds).toEqual({
      apiKey: 'sk-123',
      authToken: 'tok-9',
      baseURL: 'https://api.deepseek.com/v1',
    });
  });

  it('leaves missing fields undefined (does not invent empty strings)', async () => {
    invokeMock.mockResolvedValue({ api_key: 'only-key' });
    const creds = await readCredentials();
    expect(creds).toEqual({ apiKey: 'only-key', authToken: undefined, baseURL: undefined });
  });
});

describe('saveCredentials', () => {
  it('sends snake_case under `creds` (matches the Rust input struct)', async () => {
    invokeMock.mockResolvedValue(undefined);
    await saveCredentials({ apiKey: 'sk-x', authToken: 'tok', baseURL: 'https://h/v1' });
    expect(invokeMock).toHaveBeenCalledWith('save_credentials', {
      creds: { api_key: 'sk-x', auth_token: 'tok', base_url: 'https://h/v1' },
    });
  });

  it('round-trips with readCredentials (save shape decodes back to the same camelCase)', async () => {
    invokeMock.mockResolvedValue(undefined);
    const input = { apiKey: 'a', authToken: 'b', baseURL: 'c' };
    await saveCredentials(input);
    const sent = invokeMock.mock.calls[0]![1] as { creds: Record<string, string> };
    // Simulate the backend echoing those stored fields back on read.
    invokeMock.mockResolvedValue(sent.creds);
    expect(await readCredentials()).toEqual(input);
  });
});

describe('command name + argument contracts', () => {
  it('getAppInfo → get_app_info (no args)', async () => {
    invokeMock.mockResolvedValue({ version: '1.0.0', platform: 'darwin', home_dir: '/Users/x' });
    await getAppInfo();
    expect(invokeMock).toHaveBeenCalledWith('get_app_info');
  });

  it('saveSettingsFile → save_settings_file with { value }', async () => {
    invokeMock.mockResolvedValue(undefined);
    await saveSettingsFile({ effortLevel: 'high' });
    expect(invokeMock).toHaveBeenCalledWith('save_settings_file', {
      value: { effortLevel: 'high' },
    });
  });

  it('loadSettingsFile → load_settings_file', async () => {
    invokeMock.mockResolvedValue({});
    await loadSettingsFile();
    expect(invokeMock).toHaveBeenCalledWith('load_settings_file');
  });

  it('appendAllowMatcher → append_allow_matcher with { matcher }', async () => {
    invokeMock.mockResolvedValue(undefined);
    await appendAllowMatcher('Write');
    expect(invokeMock).toHaveBeenCalledWith('append_allow_matcher', { matcher: 'Write' });
  });

  it('sessionCreate → session_create with { cwd } and returns the id', async () => {
    invokeMock.mockResolvedValue('sess-abc');
    const id = await sessionCreate('/proj');
    expect(invokeMock).toHaveBeenCalledWith('session_create', { cwd: '/proj' });
    expect(id).toBe('sess-abc');
  });

  it('sessionAppend → session_append with { id, message }', async () => {
    invokeMock.mockResolvedValue(undefined);
    const msg = { type: 'message', role: 'user', content: [] };
    await sessionAppend('sess-abc', msg);
    expect(invokeMock).toHaveBeenCalledWith('session_append', { id: 'sess-abc', message: msg });
  });
});

describe('listPlugins', () => {
  it('invokes list_plugins and returns the camelCase rows verbatim', async () => {
    const rows = [
      {
        name: 'demo',
        version: '1.0.0',
        enabled: true,
        contributedHookEvents: ['PreToolUse'],
        sourceHash: 'abc',
        trustedBy: 'user',
      },
    ];
    invokeMock.mockResolvedValue(rows);
    const result = await listPlugins();
    expect(invokeMock).toHaveBeenCalledWith('list_plugins');
    expect(result).toEqual(rows);
  });
});

describe('listSkills', () => {
  it('invokes list_skills with the cwd and returns the rows', async () => {
    const rows = [
      { name: 'greet', description: 'd', source: 'builtin', path: '/x/SKILL.md', body: 'b' },
    ];
    invokeMock.mockResolvedValue(rows);
    const result = await listSkills('/proj');
    expect(invokeMock).toHaveBeenCalledWith('list_skills', { cwd: '/proj' });
    expect(result).toEqual(rows);
  });
});
