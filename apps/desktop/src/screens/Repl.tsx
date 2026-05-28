// REPL screen — chat surface that actually drives @deepcode/core's agent loop.
// Spec: docs/VISUAL_DESIGN.html screen #2
// Milestone: M6 (real agent integration)

import { useEffect, useRef, useState } from 'react';
import { appendAllowMatcher } from '../lib/tauri-api.js';

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
  const listRef = useRef<HTMLDivElement>(null);

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
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              pendingApproval
                ? 'Approve or reject the tool call above to continue…'
                : busy
                  ? 'Agent is responding…'
                  : 'Ask DeepCode…'
            }
            disabled={busy || pendingApproval !== null}
            className="flex-1 rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent disabled:opacity-50"
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
