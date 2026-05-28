// REPL screen — chat surface that actually drives @deepcode/core's agent loop.
// Spec: docs/VISUAL_DESIGN.html screen #2
// Milestone: M6 (real agent integration)

import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_KEYBINDINGS,
  VimState,
  type KeyBinding,
  type VimMode,
} from '@deepcode/core/dist/keybindings/vim.js';
import {
  appendAllowMatcher,
  loadKeybindings,
  loadSettingsFile,
  saveSettingsFile,
} from '../lib/tauri-api.js';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Standard',
  medium: 'Standard+',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
};
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  /** True while streaming; flips false on turn_done. */
  streaming?: boolean;
}

interface AgentStreamEvt {
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
}

interface PendingApproval {
  requestId: string;
  toolName: string;
  reason: string;
}

export function ReplScreen(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'system',
      text:
        "DeepCode is ready. Type a message below to talk to DeepSeek. " +
        "The agent can call Read / Write / Edit / Bash / Grep / Glob tools.",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [effort, setEffort] = useState<Effort>('medium');
  // Vim mode (off by default until keybindings.json#vim is true).
  const [vimEnabled, setVimEnabled] = useState(false);
  const [vimMode, setVimMode] = useState<VimMode>('INSERT');
  const vimStateRef = useRef<VimState | null>(null);
  const bindingsRef = useRef<KeyBinding[]>(DEFAULT_KEYBINDINGS);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Load Vim config + custom bindings on mount.
  useEffect(() => {
    void (async () => {
      try {
        const kb = await loadKeybindings();
        bindingsRef.current = [...DEFAULT_KEYBINDINGS, ...(kb.bindings ?? [])];
        if (kb.vim) {
          setVimEnabled(true);
          vimStateRef.current = new VimState();
          setVimMode(vimStateRef.current.mode);
        }
      } catch {
        /* keep defaults */
      }
    })();
  }, []);

  // Load saved effort on mount.
  useEffect(() => {
    void (async () => {
      try {
        const s = (await loadSettingsFile()) as { effortLevel?: string };
        if (s.effortLevel && EFFORTS.includes(s.effortLevel as Effort)) {
          setEffort(s.effortLevel as Effort);
        }
      } catch {
        /* fall back to default */
      }
    })();
  }, []);

  async function handleEffortChange(next: Effort): Promise<void> {
    setEffort(next);
    // Persist to ~/.deepcode/settings.json so the choice survives restart.
    try {
      const current = (await loadSettingsFile()) as Record<string, unknown>;
      await saveSettingsFile({ ...current, effortLevel: next });
    } catch (err) {
      console.warn('Failed to persist effort:', err);
    }
  }

  // Subscribe to agent events for the lifetime of this view
  useEffect(() => {
    if (!window.deepcode?.agent) return;
    const off = window.deepcode.agent.onEvent((raw: unknown) => {
      const e = raw as AgentStreamEvt;
      if (e.kind === 'turn_done') {
        setBusy(false);
        setActiveTurnId(null);
        // Finalize the last assistant message (drop "streaming" flag)
        setMessages((m) => {
          if (m.length === 0) return m;
          const last = m[m.length - 1]!;
          if (last.role === 'assistant' && last.streaming) {
            return [...m.slice(0, -1), { ...last, streaming: false }];
          }
          return m;
        });
        return;
      }
      // kind === 'event'
      switch (e.type) {
        case 'text_delta':
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.role === 'assistant' && last.streaming) {
              return [
                ...m.slice(0, -1),
                { ...last, text: last.text + (e.text ?? '') },
              ];
            }
            return [...m, { role: 'assistant', text: e.text ?? '', streaming: true }];
          });
          break;
        case 'tool_use':
          setMessages((m) => [
            ...m,
            {
              role: 'tool',
              text: `→ ${e.name ?? '?'}  ${formatToolArgs(e.input ?? {})}`,
            },
          ]);
          break;
        case 'tool_result':
          setMessages((m) => [
            ...m,
            {
              role: 'tool',
              text:
                (e.result?.isError ? '✕ ' : '✓ ') +
                truncate(e.result?.content ?? '', 200),
            },
          ]);
          break;
        case 'error':
          setMessages((m) => [
            ...m,
            { role: 'system', text: `✕ Error: ${e.error ?? 'unknown'}` },
          ]);
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
        // text 'usage', 'thinking_delta', 'turn_complete' silently dropped
      }
    });
    return () => off();
  }, []);

  /** Translate a DOM KeyboardEvent into a normalized chord string for VimState. */
  function chordFromEvent(e: React.KeyboardEvent<HTMLTextAreaElement>): string {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    if (e.metaKey) parts.push('meta');
    // Normalize the key half:
    //   'Escape' → 'esc', single letters → lowercased, leave others as-is
    let key = e.key;
    if (key === 'Escape') key = 'esc';
    else if (key.length === 1) key = key.toLowerCase();
    parts.push(key);
    return parts.join('+');
  }

  /** Apply a host-side action returned by VimState.feed (cursor ops, etc.). */
  function applyAction(action: string): void {
    const ta = composerRef.current;
    if (!ta) return;
    switch (action) {
      case 'cursor-line-start':
        ta.setSelectionRange(0, 0);
        break;
      case 'cursor-line-end':
        ta.setSelectionRange(ta.value.length, ta.value.length);
        break;
      case 'cursor-buffer-start':
        ta.setSelectionRange(0, 0);
        break;
      case 'cursor-buffer-end':
        ta.setSelectionRange(ta.value.length, ta.value.length);
        break;
      case 'kill-line':
      case 'kill-to-end': {
        const cur = ta.selectionStart;
        vimStateRef.current!.yanked = ta.value.slice(cur);
        setInput(ta.value.slice(0, cur));
        break;
      }
      case 'kill-to-start': {
        const cur = ta.selectionStart;
        vimStateRef.current!.yanked = ta.value.slice(0, cur);
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
      // vim-*-mode actions are handled inside VimState — no host work.
    }
  }

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Submit on plain Enter (allow Shift+Enter for newline)
    if (e.key === 'Enter' && !e.shiftKey && !vimEnabled) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
      return;
    }
    if (!vimEnabled || !vimStateRef.current) return;
    const chord = chordFromEvent(e);
    const before = vimStateRef.current.mode;
    const action = vimStateRef.current.feed(chord, bindingsRef.current);
    const after = vimStateRef.current.mode;
    if (action) {
      // We consumed the key: block default insertion + apply effect.
      e.preventDefault();
      applyAction(action);
    } else if (before === 'NORMAL') {
      // NORMAL mode: swallow uncaught keys so they don't insert text. The
      // only ALLOWED untranslated keys are arrow keys + backspace, which
      // let the user navigate even mid-binding pending.
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
            text: `✓ Added "${req.toolName}" to settings.permissions.allow`,
          },
        ]);
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            role: 'system',
            text: `⚠ Could not persist always-allow: ${(err as Error).message}`,
          },
        ]);
      }
    }
    await window.deepcode.agent.approve({ requestId: req.requestId, decision });
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const r = await window.deepcode.agent.start({
        sessionId: 'default',
        userMessage: text,
        effort,
      });
      setActiveTurnId(r.turnId);
    } catch (err) {
      setBusy(false);
      setMessages((m) => [
        ...m,
        { role: 'system', text: `✕ Failed to start: ${(err as Error).message}` },
      ]);
    }
  }

  async function handleAbort(): Promise<void> {
    if (!activeTurnId) return;
    await window.deepcode.agent.abort({ turnId: activeTurnId });
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              'rounded p-3 text-sm ' +
              (m.role === 'user'
                ? 'ml-12 bg-accent/20'
                : m.role === 'assistant'
                  ? 'mr-12 bg-bg-elevated'
                  : m.role === 'tool'
                    ? 'mx-6 bg-bg-elevated text-xs text-muted font-mono'
                    : 'mx-12 border border-border bg-bg-elevated text-muted')
            }
          >
            {m.role !== 'tool' && <div className="mb-1 text-xs text-muted">{m.role}</div>}
            <div className="whitespace-pre-wrap">
              {m.text}
              {m.streaming && <span className="ml-1 animate-pulse">▍</span>}
            </div>
          </div>
        ))}
      </div>
      {pendingApproval && (
        <div className="border-t border-accent bg-accent/10 p-3 text-sm">
          <div className="mb-2 text-fg">
            <span className="font-semibold text-accent">⏸ Approval needed</span>
            {' — '}
            <span className="font-mono">{pendingApproval.toolName}</span>
          </div>
          <div className="mb-2 whitespace-pre-wrap text-muted">
            {pendingApproval.reason}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleApproval('allow')}
              className="rounded bg-accent px-3 py-1 text-bg font-medium"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => handleApproval('deny')}
              className="rounded bg-error/80 px-3 py-1 text-fg font-medium"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => handleApproval('always')}
              className="rounded border border-accent px-3 py-1 text-accent font-medium hover:bg-accent/20"
              title="Allow this tool from now on (writes to ~/.deepcode/settings.json)"
            >
              Always allow
            </button>
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="border-t border-border p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">
          <label htmlFor="effort-select">Effort:</label>
          <select
            id="effort-select"
            value={effort}
            onChange={(e) => void handleEffortChange(e.target.value as Effort)}
            disabled={busy}
            className="rounded border border-border bg-bg px-2 py-1 text-fg outline-none focus:border-accent"
          >
            {EFFORTS.map((tier) => (
              <option key={tier} value={tier}>
                {tier} — {EFFORT_LABELS[tier]}
              </option>
            ))}
          </select>
          <span className="text-muted">
            controls max tokens + temperature for each turn
          </span>
          {vimEnabled && (
            <span
              className={
                'ml-auto rounded px-2 py-0.5 font-mono text-xs ' +
                (vimMode === 'NORMAL'
                  ? 'bg-accent/20 text-accent'
                  : vimMode === 'VISUAL'
                    ? 'bg-error/10 text-error'
                    : 'bg-bg-elevated text-muted')
              }
              title="Vim mode is active. Esc → NORMAL · i → INSERT · v → VISUAL"
            >
              -- {vimMode} --
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <textarea
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={
              pendingApproval
                ? 'Approve or reject the tool call above to continue…'
                : busy
                  ? 'Agent is responding…'
                  : vimEnabled
                    ? `[${vimMode}]  Ask DeepCode…  (Enter submits, Shift+Enter newline)`
                    : 'Ask DeepCode… (Enter submits, Shift+Enter for newline)'
            }
            disabled={busy || pendingApproval !== null}
            rows={Math.min(6, Math.max(1, input.split('\n').length))}
            className="flex-1 resize-none rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent disabled:opacity-50"
          />
          {busy ? (
            <button
              type="button"
              onClick={handleAbort}
              className="rounded bg-error/80 px-4 py-2 font-medium text-fg"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded bg-accent px-4 py-2 font-medium text-bg disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function formatToolArgs(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'command', 'pattern', 'path', 'url', 'query']) {
    const v = input[key];
    if (typeof v === 'string') return v;
  }
  return JSON.stringify(input).slice(0, 80);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
