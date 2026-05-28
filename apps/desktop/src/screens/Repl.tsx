// REPL screen — minimal chat surface for the skeleton.
// Spec: docs/VISUAL_DESIGN.html screen #2
// Milestone: M6 skeleton — wires onSubmit; the full agent loop integration
// (streaming + tools + permissions) lives in subsequent M6-rest PRs.

import { useEffect, useRef, useState } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export function ReplScreen(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'system',
      text:
        "DeepCode is ready. The Mac client's agent loop is wired in M6-rest — this " +
        "skeleton renders chat history and the input box. For real conversations " +
        "today, use the CLI: `deepcode`.",
    },
  ]);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [
      ...m,
      { role: 'user', text },
      {
        role: 'assistant',
        text: '(M6 skeleton — agent loop not yet wired. See repl.ts in apps/cli for live convos.)',
      },
    ]);
    setInput('');
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
                  : 'mx-12 border border-border bg-bg-elevated text-muted')
            }
          >
            <div className="mb-1 text-xs text-muted">{m.role}</div>
            <div className="whitespace-pre-wrap">{m.text}</div>
          </div>
        ))}
      </div>
      <form
        onSubmit={handleSubmit}
        className="border-t border-border p-3"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask DeepCode..."
            className="flex-1 rounded border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded bg-accent px-4 py-2 font-medium text-bg disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
