// Tool-call card — the design-spec primitive that renders every
// agent-issued tool invocation inline in the chat stream.
//
// Layout per docs/VISUAL_DESIGN.html screen #3:
//   ┌──────────────────────────────────────────────┐
//   │ ▸ <name>  <target>           [status badge]  │  ← tc-head
//   ├──────────────────────────────────────────────┤
//   │ <body — output or diff>                       │  ← tc-body
//   └──────────────────────────────────────────────┘

import type { ReactNode, JSX } from 'react';
import { Badge, type BadgeKind } from './Badge.js';

interface ToolCardProps {
  /** Tool name — "Read", "Edit", "Bash", etc. Rendered prefixed with ▸. */
  name: string;
  /** Optional sub-text — usually the file path or short args. */
  target?: string;
  /** Status badge ('ok' = success, 'warn' = pending approval / running, 'err' = failed). */
  status?: { kind: BadgeKind; label: string };
  /** Body content — pre-formatted (mono, preserves whitespace). */
  body?: ReactNode;
  /**
   * How the body is laid out. `diff` and `terminal` preserve columns strictly;
   * `generic` wraps. Chosen from the tool's own declared render intent — see
   * core's `tools/presentation.ts`.
   */
  layout?: 'generic' | 'diff' | 'terminal';
  /**
   * If set, the target becomes a clickable "open preview" affordance — used for
   * file tools (Read/Write/Edit) to load the file into the right-side panel.
   */
  onOpen?: () => void;
}

export function ToolCard({
  name,
  target,
  status,
  body,
  layout = 'generic',
  onOpen,
}: ToolCardProps): JSX.Element {
  return (
    <div className={'tool-card' + (onOpen ? ' openable' : '')}>
      <div className="tc-head">
        <span className="name">▸ {name}</span>
        {target &&
          (onOpen ? (
            <button
              type="button"
              className="target tc-open"
              title="Open preview in the file panel"
              onClick={onOpen}
            >
              {target} <span className="tc-open-caret">›</span>
            </button>
          ) : (
            <span className="target">{target}</span>
          ))}
        {status && <Badge kind={status.kind}>{status.label}</Badge>}
      </div>
      {body !== undefined && <div className={`tc-body ${layout}`}>{body}</div>}
    </div>
  );
}
