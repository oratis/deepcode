// DEV-ONLY full-app layout preview. Renders <App/> with a mocked Tauri
// `invoke` so the whole shell (sidebar + chat + composer + inspector) shows in
// a plain browser — lets us screenshot + iterate on the layout without the
// Tauri backend or a rebuild. Not in the prod bundle (build input = index.html).

import type {
  ProtocolEvent,
  ProtocolRequest,
  ThreadSnapshot,
  TurnSnapshot,
} from '@deepcode/protocol';
import { emit } from '@tauri-apps/api/event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installTauriShim } from './lib/window-shim.js';
import { setActiveSessionId } from './lib/mac-session.js';
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
// The file the panel opens (⌘O / dialog mock below) and its session-snapshot
// history, so the preview exercises the Diff + History tabs. CURRENT_HTML is
// what tool_read returns (the live file); the snapshots are earlier revisions.
const CURRENT_HTML = [
  '<!doctype html>',
  '<html lang="zh">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <title>打飞机</title>',
  '  </head>',
  '  <body>',
  '    <canvas id="game" width="480" height="640"></canvas>',
  '    <script>',
  '      const cvs = document.getElementById("game");',
  '      const ctx = cvs.getContext("2d");',
  '      let score = 0;',
  '      // … 游戏主循环 …',
  '    </script>',
  '  </body>',
  '</html>',
].join('\n');

const ORIGINAL_HTML = [
  '<!doctype html>',
  '<html lang="zh">',
  '  <head>',
  '    <title>打飞机</title>',
  '  </head>',
  '  <body>',
  '    <canvas id="game"></canvas>',
  '  </body>',
  '</html>',
].join('\n');

const INTERMEDIATE_HTML = [
  '<!doctype html>',
  '<html lang="zh">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <title>打飞机</title>',
  '  </head>',
  '  <body>',
  '    <canvas id="game" width="480" height="640"></canvas>',
  '  </body>',
  '</html>',
].join('\n');

const snapTime = Date.now();
const MOCK_SNAPSHOTS = [
  {
    seq: 0,
    capturedAtMs: snapTime - 600_000,
    reason: 'pre-Write',
    hash: 'h0',
    content: ORIGINAL_HTML,
  },
  {
    seq: 1,
    capturedAtMs: snapTime - 599_999,
    reason: 'post-Write',
    hash: 'h1',
    content: INTERMEDIATE_HTML,
  },
  {
    seq: 2,
    capturedAtMs: snapTime - 120_000,
    reason: 'pre-Edit',
    hash: 'h1',
    content: INTERMEDIATE_HTML,
  },
  {
    seq: 3,
    capturedAtMs: snapTime - 119_999,
    reason: 'post-Edit',
    hash: 'h3',
    content: CURRENT_HTML,
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

let nextThread = 1;
let nextTurn = 1;
let activeThreadId = MOCK_SESSIONS[0]!.id;
let activeTurn: TurnSnapshot | null = null;
const protocolRequests: ProtocolRequest[] = [];

// One fixture thread carries completed items so resume can be exercised against
// the protocol snapshot; the others stay empty so the legacy message-projection
// fallback keeps being covered too.
const THREAD_WITH_ITEMS = MOCK_SESSIONS[1]!.id;

function threadSnapshot(id: string): ThreadSnapshot {
  return {
    id,
    cwd: '/Users/oratis/Projects/DeepCode/test',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    turns:
      id === THREAD_WITH_ITEMS
        ? [
            {
              id: 'resumed-turn-1',
              threadId: id,
              status: 'completed',
              startedAt: '2026-08-01T00:00:00.000Z',
              completedAt: '2026-08-01T00:00:04.000Z',
              items: [
                {
                  id: 'i1',
                  type: 'user_message',
                  completedAt: '2026-08-01T00:00:00.000Z',
                  payload: { text: 'Harden the loader' },
                },
                {
                  id: 'i2',
                  type: 'assistant_message',
                  completedAt: '2026-08-01T00:00:01.000Z',
                  payload: {
                    message: {
                      role: 'assistant',
                      content: [
                        { type: 'text', text: 'Reading the loader.' },
                        {
                          type: 'tool_use',
                          id: 't1',
                          name: 'Read',
                          input: { file_path: 'src/loader.ts' },
                        },
                      ],
                    },
                  },
                },
                {
                  id: 'i3',
                  type: 'tool_result',
                  completedAt: '2026-08-01T00:00:02.000Z',
                  payload: {
                    message: {
                      role: 'user',
                      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
                    },
                  },
                },
                {
                  id: 'i4',
                  type: 'approval',
                  completedAt: '2026-08-01T00:00:02.500Z',
                  payload: { toolName: 'Edit', decision: 'allow' },
                },
                {
                  id: 'i5',
                  type: 'ask_user',
                  completedAt: '2026-08-01T00:00:03.000Z',
                  payload: { question: 'Which loader?', answer: 'the config one' },
                },
                {
                  id: 'i6',
                  type: 'review_finding',
                  completedAt: '2026-08-01T00:00:03.500Z',
                  payload: {
                    findingId: 'resumed-finding-1',
                    title: 'Loader swallows parse errors',
                    body: 'The catch returns undefined.',
                    path: 'src/loader.ts',
                    startLine: 42,
                    endLine: 42,
                    priority: 1,
                    replacement: 'throw err;',
                  },
                },
              ],
            },
          ]
        : [],
  };
}

async function sendProtocol(message: unknown): Promise<void> {
  await emit('app-server-output', {
    stream: 'stdout',
    line: JSON.stringify(message),
  });
}

async function sendEvent(event: ProtocolEvent): Promise<void> {
  await sendProtocol({ method: 'event', params: event });
}

async function handleProtocolRequest(request: ProtocolRequest): Promise<void> {
  protocolRequests.push(request);
  const respond = (result: unknown) => sendProtocol({ id: request.id, result });
  switch (request.method) {
    case 'initialize':
      await respond({
        protocolVersion: 1,
        capabilities: {
          threadResume: true,
          turnInterrupt: true,
          completedItemPersistence: true,
          transientDeltas: true,
          structuredToolEvents: true,
          interactiveRequests: true,
          reviewActions: true,
          reasoningDeltas: true,
          workspaceDiff: true,
          configDiagnostics: true,
        },
      });
      break;
    case 'workspace/diff':
      await respond({
        repository: true,
        base: 'HEAD',
        truncated: false,
        files: [
          {
            path: 'src/boss.ts',
            status: 'modified',
            additions: 2,
            deletions: 1,
            binary: false,
            truncated: false,
            hunks: [
              {
                header: '@@ -12,3 +12,4 @@',
                lines: [
                  {
                    kind: 'context',
                    text: 'export function spawnBoss() {',
                    oldLine: 12,
                    newLine: 12,
                  },
                  { kind: 'deletion', text: '  return new Boss(1);', oldLine: 13 },
                  { kind: 'addition', text: '  const phase = readPhase();', newLine: 13 },
                  { kind: 'addition', text: '  return new Boss(phase);', newLine: 14 },
                ],
              },
            ],
          },
          {
            path: 'assets/boss.png',
            status: 'added',
            additions: 0,
            deletions: 0,
            binary: true,
            truncated: false,
            hunks: [],
          },
        ],
      });
      break;
    case 'review/apply': {
      const findingIds = (request.params.findingIds ?? []) as string[];
      const turn: TurnSnapshot = {
        id: `preview-review-${nextTurn++}`,
        threadId: activeThreadId,
        status: 'in_progress',
        startedAt: '2026-08-01T00:00:05.000Z',
        items: [],
      };
      await sendEvent({ type: 'turn.started', threadId: activeThreadId, turn });
      await respond(turn);
      await sendEvent({
        type: 'item.completed',
        threadId: activeThreadId,
        turnId: turn.id,
        item: {
          id: 'item-review-action',
          type: 'review_action',
          completedAt: '2026-08-01T00:00:06.000Z',
          payload: { actionId: 'action-1', kind: 'apply', findingIds },
        },
      });
      await sendEvent({
        type: 'turn.completed',
        threadId: activeThreadId,
        turn: { ...turn, status: 'completed' },
      });
      break;
    }
    case 'config/diagnostics':
      await respond({
        cwd: String(request.params.cwd),
        trustStatus: 'untrusted',
        layers: [
          {
            layer: 'project',
            path: `${String(request.params.cwd)}/.deepcode/settings.json`,
            present: true,
            trusted: false,
          },
        ],
        provenance: {},
        gated: ['permissions'],
        issues: [
          {
            severity: 'warning',
            code: 'untrusted_setting_gated',
            message: 'Ignored project setting /permissions until this directory is trusted',
            pointer: '/permissions',
          },
        ],
      });
      break;
    case 'thread/start': {
      activeThreadId = `preview-thread-${nextThread++}`;
      const thread = threadSnapshot(activeThreadId);
      await sendEvent({ type: 'thread.started', thread });
      await respond(thread);
      break;
    }
    case 'thread/read':
    case 'thread/resume': {
      activeThreadId = String(request.params.threadId);
      await respond(threadSnapshot(activeThreadId));
      break;
    }
    case 'turn/start': {
      const turnId = `preview-turn-${nextTurn++}`;
      activeTurn = {
        id: turnId,
        threadId: activeThreadId,
        status: 'in_progress',
        startedAt: '2026-08-01T00:00:01.000Z',
        items: [],
      };
      // Emit before the response to exercise the renderer's fast-turn buffer.
      await sendEvent({ type: 'turn.started', threadId: activeThreadId, turn: activeTurn });
      await respond(activeTurn);
      await sendEvent({
        type: 'reasoning.delta',
        threadId: activeThreadId,
        turnId,
        itemId: 'assistant-reasoning',
        delta: 'The boss needs a phase field.\nChecking how spawnBoss reads it.',
      });
      await sendEvent({
        type: 'item.delta',
        threadId: activeThreadId,
        turnId,
        itemId: 'assistant',
        delta: 'I’ll update the game safely. ',
      });
      await sendEvent({
        type: 'tool.started',
        threadId: activeThreadId,
        turnId,
        itemId: 'fixture-edit',
        name: 'Edit',
        input: { file_path: '/Users/oratis/Projects/DeepCode/test/打飞机.html' },
      });
      await sendEvent({
        type: 'approval.requested',
        threadId: activeThreadId,
        turnId,
        requestId: 'fixture-approval',
        toolName: 'Edit',
        reason: 'The fixture verifies an approval-gated write.',
      });
      break;
    }
    case 'approval/respond': {
      await respond({ accepted: true });
      if (!activeTurn) break;
      const { id: turnId, threadId } = activeTurn;
      await sendEvent({
        type: 'tool.completed',
        threadId,
        turnId,
        itemId: 'fixture-edit',
        result: { content: 'Updated the boss encounter.' },
      });
      await sendEvent({
        type: 'item.delta',
        threadId,
        turnId,
        itemId: 'assistant',
        delta: 'The boss encounter is ready.',
      });
      await sendEvent({
        type: 'usage.updated',
        threadId,
        turnId,
        usage: { inputTokens: 2_048, outputTokens: 256, cacheReadTokens: 1_024 },
      });
      // A review finding, so the Changes panel has something to apply.
      await sendEvent({
        type: 'item.completed',
        threadId,
        turnId,
        item: {
          id: 'item-review-finding',
          type: 'review_finding',
          completedAt: '2026-08-01T00:00:02.000Z',
          payload: {
            findingId: 'finding-1',
            title: 'Boss phase is read before it is validated',
            body: 'readPhase() can return NaN; clamp it before constructing Boss.',
            path: 'src/boss.ts',
            startLine: 13,
            endLine: 13,
            priority: 1,
            replacement: '  const phase = Math.max(1, readPhase() || 1);',
          },
        },
      });
      activeTurn = { ...activeTurn, status: 'completed', completedAt: '2026-08-01T00:00:02.000Z' };
      await sendEvent({ type: 'turn.completed', threadId, turn: activeTurn });
      break;
    }
    case 'user-input/respond':
      await respond({ accepted: true });
      break;
    case 'turn/interrupt': {
      await respond({ interrupted: activeTurn !== null });
      if (!activeTurn) break;
      activeTurn = {
        ...activeTurn,
        status: 'interrupted',
        completedAt: '2026-08-01T00:00:02.000Z',
      };
      await sendEvent({
        type: 'turn.interrupted',
        threadId: activeTurn.threadId,
        turn: activeTurn,
      });
      break;
    }
  }
}

// Use Tauri's official frontend mock, including event listener registration,
// so the preview exercises the same app-server bridge as the production UI.
mockIPC(
  async (cmd: string, args?: unknown) => {
    const payload =
      args !== null && typeof args === 'object' && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {};
    switch (cmd) {
      case 'app_server_start':
      case 'app_server_status':
        return { running: true, pid: 4242 };
      case 'app_server_stop':
        return null;
      case 'app_server_send':
        await handleProtocolRequest(JSON.parse(String(payload.message)) as ProtocolRequest);
        return null;
      case 'load_settings_file':
        return { projectPath: '/Users/oratis/Projects/DeepCode/test' };
      case 'credential_status':
        return { hasKey: true, baseUrl: 'https://api.deepseek.com/v1' };
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
      // The file picker (⌘O / Files-with-no-tabs) goes through the dialog plugin.
      case 'plugin:dialog|open':
        return '/Users/oratis/Projects/DeepCode/test/打飞机.html';
      // toolRead unwraps `.content` (see lib/tauri-api.ts).
      case 'tool_read':
        return { content: CURRENT_HTML };
      // Session snapshots back the file panel's Diff + History tabs.
      case 'session_snapshots':
        return MOCK_SNAPSHOTS;
      // Voice input (🎙 composer button). Pretend it's set up; stop returns text.
      case 'voice_status':
        return {
          ready: true,
          binPath: '/opt/homebrew/bin/whisper-cli',
          modelPath: '/Users/oratis/.deepcode/models/whisper-base.en.bin',
          recorderPath: '/opt/homebrew/bin/ffmpeg',
          problems: [],
        };
      case 'voice_start':
      case 'voice_cancel':
        return null;
      case 'voice_stop':
        return 'add a dark mode toggle to the settings screen';
      case 'save_settings_file':
      case 'save_credentials':
      case 'append_allow_matcher':
      case 'session_set_title':
      case 'session_archive':
      case 'session_delete':
      case 'plugin:updater|check':
        return null;
      default:
        console.warn('[preview] unmocked invoke:', cmd);
        return null;
    }
  },
  { shouldMockEvents: true },
);

Object.defineProperty(window, '__DEEPCODE_FIXTURE__', {
  configurable: true,
  value: {
    get protocolRequests() {
      return [...protocolRequests];
    },
  },
});

installTauriShim();
// Pretend a session is active so the file panel fetches the mock snapshots above.
setActiveSessionId('preview-session');
const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<App />);
