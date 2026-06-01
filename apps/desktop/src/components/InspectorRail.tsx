// Right-column collapsed inspector rail (48 px).
// Design spec screen #3 (line ~1220).
//
// Per the spec the rail is intentionally minimal: it hints at the inspector's
// contents with four small icons (▤ Plan · ◐ Context · 📁 Recent files ·
// ⓘ Session info) and nothing else but the ‹ expand chevron and a ⚙ Settings
// shortcut. Clicking ‹ — or any of the four hint icons — expands the 320 px
// panel (the icon picks which section to scroll to). The settings cog is the
// rail's one piece of navigation; everything else (Permissions / MCP / Plugins
// / Skills / About) lives inside the Settings shell's left nav.

import type { InspectorSection } from '../types/inspector.js';

interface InspectorRailProps {
  /** Plan items pending — shown as a badge on ▤. */
  planCount?: number;
  /** Context fill 0..1 — drives the ◐ color (mint if < 0.6, warn ≥ 0.8). */
  contextFill?: number;
  /** Expand the rail into the 320 px panel, optionally focusing a section. */
  onExpand: (section?: InspectorSection) => void;
  /** Open the Settings shell. */
  onSettings: () => void;
  /** Highlight the cog when the user is on any settings-family screen. */
  settingsActive: boolean;
}

export function InspectorRail({
  planCount,
  contextFill,
  onExpand,
  onSettings,
  settingsActive,
}: InspectorRailProps): JSX.Element {
  const ctxColor =
    contextFill === undefined
      ? 'var(--text-2)'
      : contextFill > 0.8
        ? 'var(--warn)'
        : contextFill > 0.6
          ? 'var(--text-1)'
          : 'var(--accent)';

  return (
    <aside className="inspector-rail">
      <button
        type="button"
        className="rail-btn expand"
        title="Expand inspector (⌘\\)"
        onClick={() => onExpand()}
      >
        ‹
      </button>
      <div className="rail-divider" />

      <button
        type="button"
        className="rail-btn"
        title={planCount ? `Plan · ${planCount} pending` : 'Plan'}
        onClick={() => onExpand('plan')}
      >
        ▤
        {planCount !== undefined && planCount > 0 && <span className="dot-badge">{planCount}</span>}
      </button>

      <button
        type="button"
        className="rail-btn"
        title={
          contextFill === undefined
            ? 'Context: idle'
            : `Context: ${Math.round(contextFill * 100)}% used`
        }
        style={{ color: ctxColor, borderColor: 'rgba(20,228,162,.18)' }}
        onClick={() => onExpand('context')}
      >
        ◐
      </button>

      <button
        type="button"
        className="rail-btn"
        title="Recent files"
        onClick={() => onExpand('files')}
      >
        📁
      </button>

      <button
        type="button"
        className="rail-btn"
        title="Session info"
        onClick={() => onExpand('session')}
      >
        ⓘ
      </button>

      <span className="rail-spacer" />
      <button
        type="button"
        className={'rail-btn' + (settingsActive ? ' active' : '')}
        title="Settings"
        onClick={onSettings}
      >
        ⚙
      </button>
    </aside>
  );
}
