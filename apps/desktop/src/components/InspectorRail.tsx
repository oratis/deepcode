// Right-column activity bar (48 px) — always present on the far right.
//
// Each icon opens its OWN distinct right-side panel (VS Code activity-bar
// model), so it's no longer "everything opens the inspector":
//   • ⓘ Inspector — plan / context / recent files / session (toggles the panel)
//   • ▤ Files     — the file preview panel (Source / Diff / History)
//   • ⚙ Settings  — the Settings shell (a main-area screen, not a right panel)
// The active panel's icon is highlighted; clicking it again closes the panel.

interface InspectorRailProps {
  /** Inspector panel is the visible right panel. */
  inspectorActive: boolean;
  /** File preview panel is the visible right panel. */
  filesActive: boolean;
  /** On any settings-family screen (highlights the cog). */
  settingsActive: boolean;
  /** Plan items pending — badge on the Inspector icon. */
  planCount?: number;
  /** Context fill 0..1 — tints the Inspector icon (warn ≥ 0.8). */
  contextFill?: number;
  onToggleInspector: () => void;
  onToggleFiles: () => void;
  onSettings: () => void;
}

export function InspectorRail({
  inspectorActive,
  filesActive,
  settingsActive,
  planCount,
  contextFill,
  onToggleInspector,
  onToggleFiles,
  onSettings,
}: InspectorRailProps): JSX.Element {
  const ctxColor =
    contextFill === undefined
      ? undefined
      : contextFill > 0.8
        ? 'var(--warn)'
        : contextFill > 0.6
          ? 'var(--text-0)'
          : undefined;

  const ctxTitle = contextFill === undefined ? '' : ` · context ${Math.round(contextFill * 100)}%`;

  return (
    <aside className="inspector-rail">
      <button
        type="button"
        className={'rail-btn' + (inspectorActive ? ' active' : '')}
        title={`Inspector${planCount ? ` · ${planCount} pending` : ''}${ctxTitle}`}
        style={ctxColor && !inspectorActive ? { color: ctxColor } : undefined}
        onClick={onToggleInspector}
      >
        <IconInspector />
        <span className="rail-label">Inspector</span>
        {planCount !== undefined && planCount > 0 && <span className="dot-badge">{planCount}</span>}
      </button>

      <button
        type="button"
        className={'rail-btn' + (filesActive ? ' active' : '')}
        title="Files — preview, diff & history"
        onClick={onToggleFiles}
      >
        <IconFiles />
        <span className="rail-label">Files</span>
      </button>

      <span className="rail-spacer" />
      <button
        type="button"
        className={'rail-btn' + (settingsActive ? ' active' : '')}
        title="Settings"
        onClick={onSettings}
      >
        <IconSettings />
        <span className="rail-label">Settings</span>
      </button>
    </aside>
  );
}

/** Inspector — info/details glyph. */
function IconInspector(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.4v3.2" />
      <circle cx="8" cy="5.1" r="0.65" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Files — document with a folded corner + text lines. */
function IconFiles(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2.6h4.4L12 6.1v7.1a.7.7 0 0 1-.7.7H4a.7.7 0 0 1-.7-.7V3.3A.7.7 0 0 1 4 2.6Z" />
      <path d="M8.3 2.7V6.1H12" />
      <path d="M5.6 9.1h4.8M5.6 11.2h3" />
    </svg>
  );
}

/** Settings — gear. */
function IconSettings(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.6v1.9M8 12.5v1.9M3.5 3.5l1.35 1.35M11.15 11.15l1.35 1.35M1.6 8h1.9M12.5 8h1.9M3.5 12.5l1.35-1.35M11.15 4.85l1.35-1.35" />
    </svg>
  );
}
