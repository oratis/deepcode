// Chat screen — same shape as REPL but with split file panel.
// Spec: docs/VISUAL_DESIGN.html screen #2 + #8
// Milestone: M6-rest (file panel itself is M7)

import { ReplScreen } from './Repl.js';

export function ChatScreen(): JSX.Element {
  return (
    <div className="flex h-full">
      <div className="flex-1">
        <ReplScreen />
      </div>
      <div className="hidden w-1/3 border-l border-border lg:block">
        <div className="p-4 text-center text-muted">
          <p>File panel</p>
          <p className="mt-2 text-xs">
            Monaco-based file viewer · Source / Diff / History tabs — M7
          </p>
        </div>
      </div>
    </div>
  );
}
