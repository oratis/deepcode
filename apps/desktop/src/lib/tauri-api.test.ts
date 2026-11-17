// Contract tests for the renderer↔Rust IPC boundary (tauri-api.ts).
//
// These lock the command names and the snake_case↔camelCase mapping that the
// Rust #[tauri::command] handlers expect. HANDOFF §8a: casing mismatches across
// this boundary shipped real bugs twice. The Rust side is guarded by
// src-tauri/src/file_preview.rs tests; this guards the TS side.
//
// `invoke` is mocked so no Tauri runtime is needed.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  sessionSetTitle,
  sessionSnapshots,
  appServerSend,
  appServerStart,
  appServerStatus,
  appServerStop,
  appendAllowMatcher,
  credentialStatus,
  getAppInfo,
  listPlugins,
  listSkills,
  loadSettingsFile,
  saveCredentials,
  saveSettingsFile,
} from './tauri-api.js';

import { renameProtocolThread, protocolSessionSnapshots } from './protocol-agent.js';
vi.mock('./protocol-agent.js', () => ({
  renameProtocolThread: vi.fn(),
  protocolSessionSnapshots: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe('credentialStatus', () => {
  it('returns only presence and endpoint metadata to the renderer', async () => {
    invokeMock.mockResolvedValue({ hasKey: true, baseUrl: 'https://api.deepseek.com/v1' });
    await expect(credentialStatus()).resolves.toEqual({
      hasKey: true,
      baseURL: 'https://api.deepseek.com/v1',
    });
    expect(invokeMock).toHaveBeenCalledWith('credential_status');
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
});

describe('command name + argument contracts', () => {
  it('maps app-server supervision commands without exposing process details', async () => {
    invokeMock.mockResolvedValue({ running: true, pid: 42 });
    await expect(appServerStart()).resolves.toEqual({ running: true, pid: 42 });
    expect(invokeMock).toHaveBeenLastCalledWith('app_server_start');

    await appServerSend('{"id":1,"method":"initialize","params":{}}');
    expect(invokeMock).toHaveBeenLastCalledWith('app_server_send', {
      message: '{"id":1,"method":"initialize","params":{}}',
    });

    await appServerStatus();
    expect(invokeMock).toHaveBeenLastCalledWith('app_server_status');
    await appServerStop();
    expect(invokeMock).toHaveBeenLastCalledWith('app_server_stop');
  });

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

describe('v2 journal data adapters', () => {
  it('uses host rename and snapshot projections without legacy IPC', async () => {
    vi.mocked(renameProtocolThread).mockResolvedValueOnce(true);
    vi.mocked(protocolSessionSnapshots).mockResolvedValueOnce([]);
    await sessionSetTitle('v2', 'title');
    expect(await sessionSnapshots('v2', '/file')).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
  it('does not bypass an owning sidecar when rename or snapshot verification fails', async () => {
    vi.mocked(renameProtocolThread).mockRejectedValueOnce(new Error('writer conflict'));
    await expect(sessionSetTitle('v2', 'title')).rejects.toThrow('writer conflict');
    vi.mocked(protocolSessionSnapshots).mockRejectedValueOnce(new Error('checksum mismatch'));
    await expect(sessionSnapshots('v2', '/file')).rejects.toThrow('checksum');
    expect(invokeMock).not.toHaveBeenCalled();
  });
  it('retains the legacy IPC mapping for an older sidecar', async () => {
    vi.mocked(renameProtocolThread).mockResolvedValueOnce(false);
    vi.mocked(protocolSessionSnapshots).mockResolvedValueOnce(null);
    invokeMock.mockResolvedValue([]);
    await sessionSetTitle('old', 'title');
    await sessionSnapshots('old', '/file');
    expect(invokeMock).toHaveBeenCalledWith('session_set_title', { id: 'old', title: 'title' });
    expect(invokeMock).toHaveBeenCalledWith('session_snapshots', {
      sessionId: 'old',
      filePath: '/file',
    });
  });
});
