// Chat screen — REPL + side terminal pane.
// Spec: docs/VISUAL_DESIGN.html screen #2 + #8
// Milestone: M6-rest (terminal embed)

import { useState } from 'react';
import { Terminal } from '../components/Terminal.js';
import { ReplScreen } from './Repl.js';

export function ChatScreen(): JSX.Element {
  const [showTerm, setShowTerm] = useState(false);
  return (
    <div className="relative flex h-full">
      <div className="flex-1">
        <ReplScreen />
      </div>
      <div
        className={
          showTerm
            ? 'border-l border-border w-1/2'
            : 'border-l border-border w-0 overflow-hidden'
        }
      >
        {showTerm && <Terminal />}
      </div>
      <button
        type="button"
        onClick={() => setShowTerm((v) => !v)}
        className="absolute right-3 top-3 z-10 rounded border border-border bg-bg-elevated px-2 py-1 text-xs text-muted hover:text-fg"
        title={showTerm ? 'Hide terminal' : 'Show terminal (xterm)'}
      >
        {showTerm ? '◧ Hide terminal' : '⌃ Terminal'}
      </button>
    </div>
  );
}
