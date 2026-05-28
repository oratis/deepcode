// File panel — Monaco-backed file viewer with Source / Diff / History tabs.
// Spec: docs/VISUAL_DESIGN.html screens #8 and #11 (M7)

import { useEffect, useState } from 'react';
import Editor, { DiffEditor, type Monaco } from '@monaco-editor/react';
import { invoke } from '@tauri-apps/api/core';

interface OpenFile {
  path: string;
  view: 'source' | 'diff' | 'history';
  content?: string;
  /** For diff view — the prior content. */
  baseContent?: string;
  error?: string;
}

type GitLogEntry = { hash: string; date: string; subject: string };

export function FilePanel(): JSX.Element {
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<number>(0);
  const [history, setHistory] = useState<GitLogEntry[]>([]);

  function closeTab(idx: number): void {
    setFiles((fs) => fs.filter((_, i) => i !== idx));
    setActive((a) => Math.max(0, Math.min(a, files.length - 2)));
  }

  async function switchView(view: OpenFile['view']): Promise<void> {
    const current = files[active];
    if (!current) return;
    if (view === 'diff' && current.baseContent === undefined) {
      try {
        const r = (await invoke('tool_bash', {
          input: {
            command: `git show HEAD:${shellQuote(current.path)} 2>/dev/null || true`,
            timeout_ms: 10_000,
          },
        })) as { stdout: string };
        setFiles((fs) =>
          fs.map((f, i) => (i === active ? { ...f, view, baseContent: r.stdout } : f)),
        );
      } catch {
        setFiles((fs) => fs.map((f, i) => (i === active ? { ...f, view } : f)));
      }
      return;
    }
    if (view === 'history') {
      try {
        const r = (await invoke('tool_bash', {
          input: {
            command: `git log --pretty=format:'%h%x09%ad%x09%s' --date=short -- ${shellQuote(current.path)} 2>/dev/null | head -50`,
            timeout_ms: 10_000,
          },
        })) as { stdout: string };
        const entries: GitLogEntry[] = r.stdout
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            const [hash = '', date = '', subject = ''] = line.split('\t');
            return { hash, date, subject };
          });
        setHistory(entries);
      } catch {
        setHistory([]);
      }
    }
    setFiles((fs) => fs.map((f, i) => (i === active ? { ...f, view } : f)));
  }

  // Open a demo file from the cwd
  async function openDemo(): Promise<void> {
    const path = 'README.md';
    try {
      const r = (await invoke('tool_read', { filePath: path })) as { content: string };
      setFiles((fs) => [...fs, { path, view: 'source', content: r.content }]);
      setActive(files.length);
    } catch (err) {
      setFiles((fs) => [
        ...fs,
        { path, view: 'source', error: (err as Error).message ?? String(err) },
      ]);
    }
  }

  // Configure Monaco for our dark theme on first load
  function handleMount(_editor: unknown, monaco: Monaco): void {
    monaco.editor.defineTheme('deepcode-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0e0e10',
        'editor.foreground': '#f4f4f5',
        'editor.lineHighlightBackground': '#18181b',
        'editorLineNumber.foreground': '#52525b',
        'editor.selectionBackground': '#27272a',
      },
    });
    monaco.editor.setTheme('deepcode-dark');
  }

  useEffect(() => {
    // History reset on tab switch
    setHistory([]);
  }, [active]);

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border p-3 text-xs text-muted">File panel</div>
        <div className="flex flex-1 items-center justify-center p-8 text-center text-muted">
          <div>
            <p>No file open.</p>
            <p className="mt-2 text-xs">
              Files referenced in the chat will open here automatically.
            </p>
            <button
              className="mt-4 rounded bg-accent px-3 py-1 text-xs font-medium text-bg"
              onClick={openDemo}
            >
              Open README.md
            </button>
          </div>
        </div>
      </div>
    );
  }

  const current = files[active]!;
  const lang = guessLanguage(current.path);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-bg-elevated text-xs">
        {files.map((f, i) => (
          <div
            key={f.path}
            onClick={() => setActive(i)}
            className={
              'flex cursor-pointer items-center gap-1 border-r border-border px-3 py-2 ' +
              (i === active ? 'bg-bg' : 'text-muted hover:text-fg')
            }
          >
            <span>{f.path.split('/').pop()}</span>
            <button
              className="ml-1 text-muted hover:text-error"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(i);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {/* View switcher */}
      <div className="flex gap-1 border-b border-border px-2 py-1 text-xs">
        {(['source', 'diff', 'history'] as const).map((v) => (
          <button
            key={v}
            onClick={() => void switchView(v)}
            className={
              'px-2 py-1 ' +
              (current.view === v ? 'text-accent' : 'text-muted hover:text-fg')
            }
          >
            {v}
          </button>
        ))}
        <div className="ml-auto pr-2 text-muted">{current.path}</div>
      </div>
      {/* Body */}
      <div className="flex-1">
        {current.error ? (
          <div className="p-4 text-sm text-error">Error: {current.error}</div>
        ) : current.view === 'source' ? (
          <Editor
            height="100%"
            theme="deepcode-dark"
            language={lang}
            value={current.content ?? ''}
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
            onMount={handleMount}
          />
        ) : current.view === 'diff' ? (
          <DiffEditor
            height="100%"
            theme="deepcode-dark"
            language={lang}
            original={current.baseContent ?? ''}
            modified={current.content ?? ''}
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
            onMount={handleMount}
          />
        ) : (
          <div className="overflow-y-auto p-3 text-xs">
            {history.length === 0 ? (
              <p className="text-muted">No git history for this file (or not a git repo).</p>
            ) : (
              <table className="w-full text-left font-mono">
                <thead className="text-muted">
                  <tr>
                    <th className="p-2">Hash</th>
                    <th className="p-2">Date</th>
                    <th className="p-2">Subject</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((e) => (
                    <tr key={e.hash} className="border-t border-border">
                      <td className="p-2 text-accent">{e.hash}</td>
                      <td className="p-2 text-muted">{e.date}</td>
                      <td className="p-2">{e.subject}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function guessLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return (
    {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      json: 'json',
      md: 'markdown',
      py: 'python',
      rs: 'rust',
      go: 'go',
      rb: 'ruby',
      sh: 'shell',
      bash: 'shell',
      yml: 'yaml',
      yaml: 'yaml',
      html: 'html',
      css: 'css',
      sql: 'sql',
      toml: 'toml',
    }[ext] ?? 'plaintext'
  );
}
