// Right-column collapsed inspector rail (48 px).
// Design spec screen #3.
//
// Each rail button routes to a screen so users can reach Plan / Files /
// Info / Settings without scrolling for a hidden menu. The ‹ expand
// chevron is still deferred (the full-width inspector panel lands in
// the next phase) — we leave it disabled with a tooltip.

import type { ScreenName } from './Nav.js';

interface InspectorRailProps {
  /** Plan items pending — shown as a badge on ▤. */
  planCount?: number;
  /** Context fill 0..1 — drives the ◐ color (mint if < 0.6, warn ≥ 0.8). */
  contextFill?: number;
  /** Active screen so settings cog highlights when on settings. */
  activeScreen: ScreenName;
  /** Switch screen. */
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
        title="Expand inspector (⌘\\) — coming in next phase"
        disabled
      >
        ‹
      </button>
      <div className="rail-divider" />

      <button
        type="button"
        className={'rail-btn' + (activeScreen === 'permissions' ? ' active' : '')}
        title={planCount ? `Plan & permissions · ${planCount} pending` : 'Plan & permissions'}
        onClick={() => onChange('permissions')}
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
        onClick={() => onChange('repl')}
      >
        ◐
      </button>

      <button
        type="button"
        className={'rail-btn' + (activeScreen === 'sessions' ? ' active' : '')}
        title="Sessions"
        onClick={() => onChange('sessions')}
      >
        ◫
      </button>

      <button
        type="button"
        className={'rail-btn' + (activeScreen === 'plugins' ? ' active' : '')}
        title="Plugins"
        onClick={() => onChange('plugins')}
      >
        ⊞
      </button>

      <button
        type="button"
        className={'rail-btn' + (activeScreen === 'skills' ? ' active' : '')}
        title="Skills"
        onClick={() => onChange('skills')}
      >
        ✦
      </button>

      <button
        type="button"
        className={'rail-btn' + (activeScreen === 'mcp' ? ' active' : '')}
        title="MCP servers"
        onClick={() => onChange('mcp')}
      >
        ⊕
      </button>

      <button
        type="button"
        className={'rail-btn' + (activeScreen === 'about' ? ' active' : '')}
        title="About / Info"
        onClick={() => onChange('about')}
      >
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
