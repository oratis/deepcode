// Right-column collapsed inspector (48 px) — design spec screen #3.
// Five rail buttons with optional dot-badge counts:
//   ‹ (expand) · ▤ (Plan + N) · ◐ (context %) · 📁 (files) · ⓘ (info) · ⚙ (settings)
//
// For v0.1.1 expand is a stub — clicking ‹ does nothing yet (the
// full-width inspector panel lands in P2 with the rest of the screens).

import type { ScreenName } from './Nav.js';

interface InspectorRailProps {
  /** Plan items pending — shown as a badge on ▤. */
  planCount?: number;
  /** Context fill 0..1 — drives the ◐ color (mint if < 0.6, warn ≥ 0.8). */
  contextFill?: number;
  /** Active screen so settings cog highlights when on settings. */
  activeScreen: ScreenName;
  /** Switch screen — only wired for settings cog right now. */
  onChange: (screen: ScreenName) => void;
}

export function InspectorRail({
  planCount,
  contextFill,
  activeScreen,
  onChange,
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
        className="rail-btn"
        title="Expand inspector  (⌘\\) — coming in P2"
        disabled
      >
        ‹
      </button>
      <div className="rail-divider" />
      <button
        type="button"
        className="rail-btn"
        title={planCount ? `Plan · ${planCount} pending` : 'Plan'}
      >
        ▤
        {planCount !== undefined && planCount > 0 && (
          <span className="dot-badge">{planCount}</span>
        )}
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
      >
        ◐
      </button>
      <button
        type="button"
        className="rail-btn"
        title="Recent files"
        onClick={() => onChange('repl')}
      >
        📁
      </button>
      <button type="button" className="rail-btn" title="Session info">
        ⓘ
      </button>
      <span className="rail-spacer" />
      <button
        type="button"
        className={'rail-btn' + (activeScreen === 'settings' ? ' active' : '')}
        title="Settings"
        onClick={() => onChange('settings')}
      >
        ⚙
      </button>
    </aside>
  );
}
