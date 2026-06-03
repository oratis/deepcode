// DEV-ONLY full-app layout preview. Renders <App/> with a mocked Tauri
// `invoke` so the whole shell (sidebar + chat + composer + inspector) shows in
// a plain browser — lets us screenshot + iterate on the layout without the
// Tauri backend or a rebuild. Not in the prod bundle (build input = index.html).

import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installTauriShim } from './lib/window-shim.js';
import './index.css';

const now = Math.floor(Date.now() / 1000);
const MOCK_SESSIONS = [
  {
    id: '2026-06-02-aaa111',
    path: '',
    size_bytes: 900,
    updated_at_secs: now - 3600,
    title: '制作一个打飞机的小游戏',
  },
  {
    id: '2026-06-02-bbb222',
    path: '',
    size_bytes: 700,
    updated_at_secs: now - 7200,
    title: '写一个超级马里奥的小游戏',
  },
  {
    id: '2026-06-01-ccc333',
    path: '',
    size_bytes: 500,
    updated_at_secs: now - 90_000,
    title: '重构 auth 模块并加单测',
  },
  {
    id: '2026-05-31-ddd444',
    path: '',
    size_bytes: 300,
    updated_at_secs: now - 180_000,
    title: 'hi',
  },
];
const MOCK_MESSAGES = [
  { type: 'message', role: 'user', content: [{ type: 'text', text: '制作一个打飞机的小游戏' }] },
  {
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '好的，我来创建一个 HTML5 打飞机射击游戏，包含玩家飞机、敌机、子弹和计分。',
      },
      {
        type: 'tool_use',
        id: 't1',
        name: 'Write',
        input: { file_path: '/Users/oratis/Projects/DeepCode/test/打飞机.html' },
      },
    ],
  },
  { type: 'message', role: 'user', content: [{ type: 'text', text: '加一个 boss 关卡' }] },
];

// Mock the Tauri invoke bridge before the app calls it (no invoke runs at import).
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string) => {
    switch (cmd) {
      case 'load_settings_file':
        return { projectPath: '/Users/oratis/Projects/DeepCode/test' };
      case 'read_credentials':
        return { api_key: 'sk-mock', base_url: 'https://api.deepseek.com/v1' };
      case 'get_app_info':
        return { version: '0.1.6', platform: 'macos', home_dir: '/Users/oratis' };
      case 'get_settings_path':
        return '/Users/oratis/.deepcode/settings.json';
      case 'list_sessions':
        return MOCK_SESSIONS;
      case 'session_read':
        return MOCK_MESSAGES;
      case 'load_keybindings':
        return {};
      case 'list_plugins':
      case 'list_skills':
        return [];
      default:
        console.warn('[preview] unmocked invoke:', cmd);
        return null;
    }
  },
  transformCallback: (cb: unknown) => cb,
};

installTauriShim();
const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<App />);
