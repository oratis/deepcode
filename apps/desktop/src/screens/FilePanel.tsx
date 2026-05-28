// File panel — right-side Monaco-based viewer with Source / Diff / History tabs.
// Spec: docs/VISUAL_DESIGN.html screens #8 and #11 (M7)
// Milestone: M6-rest skeleton; Monaco wiring lands when the binary dep is installed.

import { useState } from 'react';

interface OpenFile {
  path: string;
  view: 'source' | 'diff' | 'history';
}

export function FilePanel(): JSX.Element {
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<number>(0);

  function closeTab(idx: number): void {
    setFiles((fs) => fs.filter((_, i) => i !== idx));
    setActive((a) => Math.max(0, Math.min(a, files.length - 2)));
  }

  function switchView(view: OpenFile['view']): void {
    setFiles((fs) => fs.map((f, i) => (i === active ? { ...f, view } : f)));
  }

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border p-3 text-xs text-muted">File panel · M7</div>
        <div className="flex flex-1 items-center justify-center p-8 text-center text-muted">
          <div>
            <p>No file open.</p>
            <p className="mt-2 text-xs">
              Files referenced in the chat will open here automatically.
            </p>
            <button
              className="mt-4 rounded bg-accent px-3 py-1 text-xs font-medium text-bg"
              onClick={() => setFiles([{ path: 'demo/README.md', view: 'source' }])}
            >
              Open a demo tab
            </button>
          </div>
        </div>
      </div>
    );
  }

  const current = files[active]!;
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
            onClick={() => switchView(v)}
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
      {/* Body — Monaco lives here in M7. Stub shows the placeholder. */}
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        <div className="text-muted">
          Monaco editor mounts here in M7. {current.view} view of <code>{current.path}</code>.
        </div>
      </div>
    </div>
  );
}
