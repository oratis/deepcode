// Tool-call card — the design-spec primitive that renders every
// agent-issued tool invocation inline in the chat stream.
//
// Layout per docs/VISUAL_DESIGN.html screen #3:
//   ┌──────────────────────────────────────────────┐
//   │ ▸ <name>  <target>           [status badge]  │  ← tc-head
//   ├──────────────────────────────────────────────┤
//   │ <body — output or diff>                       │  ← tc-body
//   └──────────────────────────────────────────────┘

import type { ReactNode } from 'react';
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
  /** If true, body is a diff (line-by-line; preserves whitespace strictly). */
  diff?: boolean;
}

export function ToolCard({ name, target, status, body, diff }: ToolCardProps): JSX.Element {
  return (
    <div className="tool-card">
      <div className="tc-head">
        <span className="name">▸ {name}</span>
        {target && <span className="target">{target}</span>}
        {status && <Badge kind={status.kind}>{status.label}</Badge>}
      </div>
      {body !== undefined && <div className={diff ? 'tc-body diff' : 'tc-body'}>{body}</div>}
    </div>
  );
}
