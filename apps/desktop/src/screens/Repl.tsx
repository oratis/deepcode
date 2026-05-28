// REPL / Chat screen — design-aligned per docs/VISUAL_DESIGN.html #3.
//
// Layout:
//   .chat-header  → breadcrumb + status pills (connected · model · approval)
//   .chat-stream  → message rows. Each row is .msg.{user|assistant|system}
//                   with a 28 px avatar and a .body that holds plain text
//                   PLUS any tool-call cards the agent emitted during that
//                   assistant turn.
//   inline approval panel → sits directly under the relevant tool card
//                   (per design note ③ — never at screen bottom)
//   .composer     → .box with textarea + .toolbar (mode badge · model
//                   picker · effort · send) + .ctx-bar (context usage)
//
// The streaming logic carries over from the previous version: we
// subscribe to window.deepcode.agent.onEvent and incrementally update
// state. The only structural change vs. the previous Repl.tsx is the
// CSS class names (which now match the design tokens) and the addition
// of richer tool-card rendering.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_KEYBINDINGS,
  VimState,
  type KeyBinding,
  type VimMode,
} from '@deepcode/core/dist/keybindings/vim.js';
import { Dropdown, type DropdownOption } from '../components/Dropdown.js';
import { Pill } from '../components/Pill.js';
import { ToolCard } from '../components/ToolCard.js';
import { projectName } from '../lib/project.js';
import {
  appendAllowMatcher,
  loadKeybindings,
  loadSettingsFile,
  saveSettingsFile,
} from '../lib/tauri-api.js';

interface ReplScreenProps {
  projectPath: string;
  /** Called after each turn ends so the parent can refresh the sidebar. */
  onTurnComplete?: () => void;
}

// ─── Types ────────────────────────────────────────────────────────────

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const EFFORT_OPTIONS: DropdownOption<Effort>[] = [
  { value: 'low', label: 'Low', meta: '4k', description: 'Cheap & quick — short answers, simple edits.' },
  { value: 'medium', label: 'Medium', meta: '8k', description: 'Balanced default. Good for most coding tasks.' },
  { value: 'high', label: 'High', meta: '16k', description: 'Longer context — multi-file refactors.' },
  { value: 'xhigh', label: 'Extra High', meta: '24k', description: 'Deep reasoning for architecture changes.' },
  { value: 'max', label: 'Max', meta: '32k', description: 'Max tokens. Slow & expensive — use sparingly.' },
];

const MODEL_OPTIONS: DropdownOption<'deepseek-chat' | 'deepseek-reasoner'>[] = [
  { value: 'deepseek-chat', label: 'DeepSeek-Chat', meta: '128k', description: 'Faster, cheaper. Best default.' },
  {
    value: 'deepseek-reasoner',
    label: 'DeepSeek-Reasoner (R1)',
    meta: '128k',
    description: 'Chain-of-thought reasoning for hard problems.',
  },
];

const MODE_OPTIONS: DropdownOption<
  'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
>[] = [
  { value: 'default', label: 'Default', meta: '●', description: 'Ask before every tool call that needs approval.' },
  {
    value: 'acceptEdits',
    label: 'Accept edits',
    meta: '✎',
    description: 'Auto-approve Edit/Write; still ask for Bash and dangerous tools.',
  },
  {
    value: 'plan',
    label: 'Plan mode',
    meta: '◐',
    description: 'Read-only — write tools blocked. Use for exploring.',
  },
  {
    value: 'dontAsk',
    label: "Don't ask",
    meta: '↯',
    description: 'Auto-approve everything safe (no destructive operations).',
  },
  {
    value: 'bypassPermissions',
    label: 'Bypass',
    meta: '⚡',
    description: 'YOLO. Run anything, no approvals. Use only in scratch dirs.',
  },
];

interface ToolInvocation {
  toolId: string;
  name: string;
  target?: string;
  input: Record<string, unknown>;
  status: 'running' | 'ok' | 'err';
  resultText?: string;
}

interface AssistantTurn {
  text: string;
  /** Tool calls interleaved during this turn — rendered as cards after the text. */
  tools: ToolInvocation[];
  streaming: boolean;
}

interface UserMsg {
  role: 'user';
  text: string;
}
interface AssistantMsg {
  role: 'assistant';
  turn: AssistantTurn;
}
interface SystemMsg {
  role: 'system';
  text: string;
  level?: 'info' | 'error';
}
type Msg = UserMsg | AssistantMsg | SystemMsg;

interface AgentEvt {
  kind: 'event' | 'turn_done';
  turnId: string;
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  result?: { content: string; isError?: boolean };
  error?: string;
  stopReason?: string;
  // permission_request fields
  requestId?: string;
  toolName?: string;
  reason?: string;
  // tool_use carries id; we use it on tool_result to attach output to the right card
  id?: string;
}

interface PendingApproval {
  requestId: string;
  toolName: string;
  reason: string;
}

// ─── Component ────────────────────────────────────────────────────────

export function ReplScreen({
  projectPath,
  onTurnComplete,
}: ReplScreenProps): JSX.Element {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'system',
      text: `DeepCode is ready in ${projectPath}. Ask anything about your codebase — I can Read / Write / Edit / Bash / Grep / Glob your files.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [effort, setEffort] = useState<Effort>('medium');
  const [model, setModel] = useState<string>('deepseek-chat');
  const [mode, setMode] = useState<
    'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  >('default');
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number }>({
    inputTokens: 0,
    outputTokens: 0,
  });
  const [vimEnabled, setVimEnabled] = useState(false);
  const [vimMode, setVimMode] = useState<VimMode>('INSERT');
  const vimStateRef = useRef<VimState | null>(null);
  const bindingsRef = useRef<KeyBinding[]>(DEFAULT_KEYBINDINGS);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // ── Load settings + keybindings on mount ──
  useEffect(() => {
    void (async () => {
      try {
        const s = (await loadSettingsFile()) as {
          effortLevel?: string;
          model?: string;
        };
        if (s.effortLevel && (EFFORTS as string[]).includes(s.effortLevel)) {
          setEffort(s.effortLevel as Effort);
        }
        if (s.model) setModel(s.model);
      } catch {
        /* defaults */
      }
      try {
        const kb = await loadKeybindings();
        bindingsRef.current = [...DEFAULT_KEYBINDINGS, ...(kb.bindings ?? [])];
        if (kb.vim) {
          setVimEnabled(true);
          vimStateRef.current = new VimState();
          setVimMode(vimStateRef.current.mode);
        }
      } catch {
        /* defaults */
      }
    })();
  }, []);

  // ── Subscribe to agent events ──
  useEffect(() => {
    if (!window.deepcode?.agent) return;
    const off = window.deepcode.agent.onEvent((raw: unknown) => {
      const e = raw as AgentEvt;
      if (e.kind === 'turn_done') {
        setBusy(false);
        setActiveTurnId(null);
        setMessages((m) => finalizeStreaming(m));
        onTurnComplete?.();
        return;
      }
      switch (e.type) {
        case 'text_delta':
          setMessages((m) => appendTextDelta(m, e.text ?? ''));
          break;
        case 'tool_use':
          setMessages((m) =>
            appendToolUse(m, {
              toolId: e.id ?? `tu-${Date.now()}`,
              name: e.name ?? '?',
              input: e.input ?? {},
              target: pickTarget(e.input ?? {}),
              status: 'running',
            }),
          );
          break;
        case 'tool_result':
          setMessages((m) =>
            attachToolResult(
              m,
              e.id ?? '',
              e.result?.content ?? '',
              e.result?.isError ? 'err' : 'ok',
            ),
          );
          break;
        case 'usage':
          // Some providers emit a usage event; track for the ctx bar
          if (typeof e.input === 'object' && e.input) {
            const u = e.input as { inputTokens?: number; outputTokens?: number };
            setUsage({
              inputTokens: u.inputTokens ?? 0,
              outputTokens: u.outputTokens ?? 0,
            });
          }
          break;
        case 'error':
          setMessages((m) => [
            ...m,
            { role: 'system', text: `✕ ${e.error ?? 'unknown error'}`, level: 'error' },
          ]);
          setBusy(false);
          break;
        case 'permission_request':
          if (e.requestId && e.toolName) {
            setPendingApproval({
              requestId: e.requestId,
              toolName: e.toolName,
              reason: e.reason ?? `Approve ${e.toolName}?`,
            });
          }
          break;
      }
    });
    return () => off();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  // ── Effort persist ──
  async function handleEffortChange(next: Effort): Promise<void> {
    setEffort(next);
    try {
      const cur = (await loadSettingsFile()) as Record<string, unknown>;
      await saveSettingsFile({ ...cur, effortLevel: next });
    } catch (err) {
      console.warn('persist effort:', err);
    }
  }

  // ── Vim ──
  function chordFromEvent(e: React.KeyboardEvent<HTMLTextAreaElement>): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    if (e.metaKey) parts.push('meta');
    let key = e.key;
    if (key === 'Escape') key = 'esc';
    else if (key.length === 1) key = key.toLowerCase();
    parts.push(key);
    return parts.join('+');
  }
  function applyAction(action: string): void {
    const ta = composerRef.current;
    if (!ta) return;
    switch (action) {
      case 'cursor-line-start':
      case 'cursor-buffer-start':
        ta.setSelectionRange(0, 0);
        break;
      case 'cursor-line-end':
      case 'cursor-buffer-end':
        ta.setSelectionRange(ta.value.length, ta.value.length);
        break;
      case 'kill-line':
      case 'kill-to-end': {
        const cur = ta.selectionStart;
        if (vimStateRef.current) vimStateRef.current.yanked = ta.value.slice(cur);
        setInput(ta.value.slice(0, cur));
        break;
      }
      case 'kill-to-start': {
        const cur = ta.selectionStart;
        if (vimStateRef.current) vimStateRef.current.yanked = ta.value.slice(0, cur);
        setInput(ta.value.slice(cur));
        break;
      }
      case 'yank-line':
        if (vimStateRef.current) vimStateRef.current.yanked = ta.value;
        break;
      case 'paste-after': {
        const cur = ta.selectionStart;
        const y = vimStateRef.current?.yanked ?? '';
        setInput(ta.value.slice(0, cur) + y + ta.value.slice(cur));
        break;
      }
    }
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter submits when vim is off; in vim INSERT mode also submits.
    if (e.key === 'Enter' && !e.shiftKey) {
      if (!vimEnabled || vimStateRef.current?.mode === 'INSERT') {
        e.preventDefault();
        void handleSubmit(e as unknown as React.FormEvent);
        return;
      }
    }
    if (!vimEnabled || !vimStateRef.current) return;
    const chord = chordFromEvent(e);
    const before = vimStateRef.current.mode;
    const action = vimStateRef.current.feed(chord, bindingsRef.current);
    const after = vimStateRef.current.mode;
    if (action) {
      e.preventDefault();
      applyAction(action);
    } else if (before === 'NORMAL') {
      if (
        e.key !== 'ArrowLeft' &&
        e.key !== 'ArrowRight' &&
        e.key !== 'ArrowUp' &&
        e.key !== 'ArrowDown' &&
        e.key !== 'Backspace'
      ) {
        e.preventDefault();
      }
    }
    if (after !== before) setVimMode(after);
  }

  // ── Approval ──
  async function handleApproval(
    decision: 'allow' | 'deny' | 'always',
  ): Promise<void> {
    if (!pendingApproval) return;
    const req = pendingApproval;
    setPendingApproval(null);
    if (decision === 'always') {
      try {
        await appendAllowMatcher(req.toolName);
        setMessages((m) => [
          ...m,
          {
            role: 'system',
            text: `✓ "${req.toolName}" added to settings.permissions.allow`,
          },
        ]);
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            role: 'system',
            text: `⚠ Could not persist always-allow: ${(err as Error).message}`,
            level: 'error',
          },
        ]);
      }
    }
    await window.deepcode.agent.approve({ requestId: req.requestId, decision });
  }

  // ── Send ──
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || pendingApproval) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const r = await window.deepcode.agent.start({
        sessionId: 'default',
        userMessage: text,
        effort,
        model,
        mode,
        cwd: projectPath,
      });
      setActiveTurnId(r.turnId);
    } catch (err) {
      setBusy(false);
      setMessages((m) => [
        ...m,
        {
          role: 'system',
          text: `✕ Failed to start: ${(err as Error).message ?? err}`,
          level: 'error',
        },
      ]);
    }
  }

  async function handleAbort(): Promise<void> {
    if (!activeTurnId) return;
    await window.deepcode.agent.abort({ turnId: activeTurnId });
  }

  // Lock all the toolbar controls (mode / model / effort) once a turn
  // is in flight or pending approval — changing them mid-turn would
  // contradict the system prompt already sent.
  const controlsLocked = busy || pendingApproval !== null;

  // ── Context bar fill ──
  const contextWindow = 128_000;
  const usedTokens = usage.inputTokens + usage.outputTokens;
  const fillPct = Math.min(100, (usedTokens / contextWindow) * 100);

  // Header status pills
  const headerPills = useMemo(
    () => (
      <>
        <Pill dot>connected</Pill>
        <Pill>{model}</Pill>
        <Pill>
          {mode === 'bypassPermissions'
            ? 'approval: skipped'
            : mode === 'plan'
              ? 'plan mode'
              : 'approval: ask'}
        </Pill>
      </>
    ),
    [model, mode],
  );

  return (
    <>
      <div className="chat-header">
        <span className="crumb">
          <b>{projectName(projectPath)}</b>
          {' · '}
          <span title={projectPath} className="muted">
            {abbreviatePath(projectPath)}
          </span>
        </span>
        <div className="right">{headerPills}</div>
      </div>

      <div className="chat-stream" ref={listRef}>
        {messages.map((m, i) => renderMessage(m, i, pendingApproval, handleApproval))}

        {busy && !pendingApproval && (
          <div className="msg assistant">
            <div className="avatar">DC</div>
            <div className="body">
              <div className="author">DeepCode · thinking</div>
              <div className="content">
                <span className="spinner" /> <span className="muted">working…</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="composer">
        <form onSubmit={handleSubmit}>
          <div className="box">
            <textarea
              ref={composerRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                pendingApproval
                  ? 'Approve or reject the tool call above to continue…'
                  : busy
                    ? 'Agent is responding…'
                    : '问点什么…   @ 引用文件   ·   / 命令   ·   # 写入 DEEPCODE.md'
              }
              disabled={busy || pendingApproval !== null}
              rows={Math.min(6, Math.max(1, input.split('\n').length))}
            />
            <div className="toolbar">
              <button
                type="button"
                className="icon-btn"
                title="附件 / 命令 / 插件 — 待 P2"
                disabled
              >
                +
              </button>

              <Dropdown<typeof mode>
                value={mode}
                onChange={setMode}
                disabled={controlsLocked}
                triggerClass={
                  'mode-badge ' +
                  (mode === 'bypassPermissions'
                    ? 'bypass'
                    : mode === 'plan'
                      ? 'plan'
                      : 'default')
                }
                renderTrigger={(opt) => <span>{opt.meta} {opt.label}</span>}
                title="Mode controls how tool calls are approved"
                panelWidth={300}
                options={MODE_OPTIONS}
              />

              {vimEnabled && (
                <span
                  className={
                    'vim-chip ' +
                    (vimMode === 'NORMAL'
                      ? 'normal'
                      : vimMode === 'VISUAL'
                        ? 'visual'
                        : '')
                  }
                  title="Vim mode is on"
                >
                  -- {vimMode} --
                </span>
              )}
              <span className="spacer" />

              <Dropdown<typeof model>
                value={model}
                onChange={setModel}
                disabled={controlsLocked}
                dot
                title="DeepSeek model"
                panelWidth={280}
                options={MODEL_OPTIONS}
                renderTrigger={(opt) => (
                  <>
                    <span>{opt.label}</span>
                    <span className="meta">{opt.meta}</span>
                  </>
                )}
              />

              <Dropdown<Effort>
                value={effort}
                onChange={(v) => void handleEffortChange(v)}
                disabled={controlsLocked}
                title="Effort — maxTokens + temperature"
                panelWidth={280}
                options={EFFORT_OPTIONS}
                renderTrigger={(opt) => (
                  <>
                    <span>{opt.label}</span>
                    <span className="meta">{opt.meta}</span>
                  </>
                )}
              />

              {busy ? (
                <button
                  type="button"
                  onClick={handleAbort}
                  className="send-btn stop"
                  title="Stop (⌘.)"
                >
                  ■
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-btn"
                  disabled={!input.trim() || pendingApproval !== null}
                  title="Send (⌘↵)"
                >
                  ↵
                </button>
              )}
            </div>
          </div>
        </form>
        <div className="ctx-bar">
          <span>
            {usedTokens.toLocaleString()} / {contextWindow.toLocaleString()}
          </span>
          <div className="progress">
            <div className="fill" style={{ width: `${fillPct}%` }} />
          </div>
          <span>{fillPct.toFixed(1)}%</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>
            ¥ {((usage.inputTokens / 1_000_000) * 1.0 + (usage.outputTokens / 1_000_000) * 2.0).toFixed(4)}
          </span>
        </div>
      </div>
    </>
  );
}

// ─── Message renderer ─────────────────────────────────────────────────

function renderMessage(
  m: Msg,
  i: number,
  pendingApproval: PendingApproval | null,
  onApproval: (decision: 'allow' | 'deny' | 'always') => void,
): JSX.Element | null {
  if (m.role === 'user') {
    return (
      <div className="msg user" key={i}>
        <div className="avatar">YO</div>
        <div className="body">
          <div className="author">You</div>
          <div className="content">{m.text}</div>
        </div>
      </div>
    );
  }
  if (m.role === 'system') {
    return (
      <div className="msg system" key={i}>
        <div className="avatar">i</div>
        <div className="body">
          <div className="author">System</div>
          <div
            className="content"
            style={{
              color:
                m.level === 'error' ? 'var(--error)' : 'var(--text-2)',
              fontSize: 12,
              fontFamily: m.level === 'error' ? 'JetBrains Mono, monospace' : undefined,
            }}
          >
            {m.text}
          </div>
        </div>
      </div>
    );
  }
  // assistant
  return (
    <div className="msg assistant" key={i}>
      <div className="avatar">DC</div>
      <div className="body">
        <div className="author">DeepCode</div>
        <div className="content">
          {m.turn.text}
          {m.turn.streaming && <span className="streaming-cursor" />}
          {m.turn.tools.map((t) => (
            <div key={t.toolId}>
              <ToolCard
                name={t.name}
                target={t.target}
                status={{
                  kind: t.status === 'running' ? 'info' : t.status === 'ok' ? 'ok' : 'err',
                  label:
                    t.status === 'running'
                      ? '… running'
                      : t.status === 'ok'
                        ? '✓ done'
                        : '✕ error',
                }}
                body={t.resultText ? truncate(t.resultText, 1500) : undefined}
              />
              {/* Inline approval — appears right under the relevant tool card */}
              {pendingApproval && pendingApproval.toolName === t.name && t.status === 'running' && (
                <div className="approval-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onApproval('allow')}
                  >
                    Approve (↵)
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onApproval('deny')}
                  >
                    Reject (esc)
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onApproval('always')}
                    title="Persist to ~/.deepcode/settings.json#permissions.allow"
                  >
                    Always allow {t.name} in this session
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Mutators ────────────────────────────────────────────────────────

/** Abbreviate a long path by replacing $HOME prefix with "~". */
function abbreviatePath(p: string): string {
  // Best-effort home detection — works for /Users/<n>/... on macOS
  const m = p.match(/^\/Users\/[^/]+/);
  if (m) return '~' + p.slice(m[0].length);
  return p;
}

function pickTarget(input: Record<string, unknown>): string | undefined {
  for (const k of ['file_path', 'command', 'pattern', 'path', 'url', 'query']) {
    const v = input[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…\n[truncated]' : s;
}

function lastAssistantTurn(msgs: Msg[]): AssistantTurn | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.role === 'assistant') return m.turn;
  }
  return null;
}

function appendTextDelta(msgs: Msg[], delta: string): Msg[] {
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant' && last.turn.streaming) {
    return [
      ...msgs.slice(0, -1),
      {
        role: 'assistant',
        turn: { ...last.turn, text: last.turn.text + delta },
      },
    ];
  }
  return [
    ...msgs,
    {
      role: 'assistant',
      turn: { text: delta, tools: [], streaming: true },
    },
  ];
}

function appendToolUse(msgs: Msg[], tool: ToolInvocation): Msg[] {
  // Attach to the last assistant turn; if none open, start one
  const last = msgs[msgs.length - 1];
  if (last && last.role === 'assistant' && last.turn.streaming) {
    return [
      ...msgs.slice(0, -1),
      {
        role: 'assistant',
        turn: { ...last.turn, tools: [...last.turn.tools, tool] },
      },
    ];
  }
  return [
    ...msgs,
    {
      role: 'assistant',
      turn: { text: '', tools: [tool], streaming: true },
    },
  ];
}

function attachToolResult(
  msgs: Msg[],
  toolId: string,
  content: string,
  status: 'ok' | 'err',
): Msg[] {
  const turn = lastAssistantTurn(msgs);
  if (!turn) return msgs;
  return msgs.map((m): Msg => {
    if (m.role !== 'assistant') return m;
    const idx = m.turn.tools.findIndex((t) => t.toolId === toolId);
    if (idx === -1) {
      // Fallback: attach to the last running tool
      // ES2022-safe: find last running tool by reverse iteration
      let runningIdx = -1;
      for (let j = m.turn.tools.length - 1; j >= 0; j--) {
        if (m.turn.tools[j]!.status === 'running') {
          runningIdx = j;
          break;
        }
      }
      if (runningIdx === -1) return m;
      const tools = [...m.turn.tools];
      tools[runningIdx] = {
        ...tools[runningIdx]!,
        status,
        resultText: content,
      };
      return { ...m, turn: { ...m.turn, tools } };
    }
    const tools = [...m.turn.tools];
    tools[idx] = { ...tools[idx]!, status, resultText: content };
    return { ...m, turn: { ...m.turn, tools } };
  });
}

function finalizeStreaming(msgs: Msg[]): Msg[] {
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'assistant' || !last.turn.streaming) return msgs;
  return [
    ...msgs.slice(0, -1),
    { role: 'assistant', turn: { ...last.turn, streaming: false } },
  ];
}
