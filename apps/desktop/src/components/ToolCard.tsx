// Tool-call card — the design-spec primitive that renders every
// agent-issued tool invocation inline in the chat stream.
//
// Layout per docs/VISUAL_DESIGN.html screen #3:
//   ┌──────────────────────────────────────────────┐
//   │ ▸ <name>  <target>           [status badge]  │  ← tc-head
//   ├──────────────────────────────────────────────┤
//   │ <body — output or diff>                       │  ← tc-body
//   └──────────────────────────────────────────────┘

import { useId, useState, type ReactNode, type JSX } from 'react';
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
   * `locations` is a one-entry-per-line list of openable paths; `generic`
   * wraps. Chosen from the tool's own declared render intent — see core's
   * `tools/presentation.ts`.
   */
  layout?: 'generic' | 'diff' | 'terminal' | 'locations';
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
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const detailId = useId();
  // Failed and pending calls remain inspectable without an extra click. Only
  // successful/unknown historical output is collapsed by default.
  const open = expanded ?? (status?.kind === 'err' || status?.kind === 'warn');
  return (
    <div className={'tool-card' + (onOpen ? ' openable' : '')}>
      <div className="tc-head">
        <button
          type="button"
          className="name tc-disclose"
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={`${open ? 'Hide' : 'Show'} ${name} details`}
          onClick={() => setExpanded(!open)}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> {name}
        </button>
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
      {open && body !== undefined && (
        <div id={detailId} className={`tc-body ${layout}`}>
          {body}
        </div>
      )}
    </div>
  );
}
