// Settings shell — design spec screen #9 (`.settings-shell` / `.set-nav`).
//
// The spec collapses the inspector rail to four passive hint icons + a single
// ⚙ Settings shortcut; all the configuration screens (Permissions / MCP /
// Plugins / Skills / About) that used to hang off the rail now live behind that
// cog, reachable from a shared left nav. This component renders that nav and
// hosts the active screen as its right-hand pane.
//
// Only screens that actually exist are listed — no dead links. (The spec's
// Models / Hooks / Memory / Statusline items land with their screens later.)

import type { ReactNode } from 'react';
import type { ScreenName } from '../types/screens.js';

/** The screens that live inside the Settings shell, in nav order. */
export const SETTINGS_FAMILY: ScreenName[] = [
  'settings',
  'permissions',
  'mcp',
  'plugins',
  'skills',
  'about',
];

interface NavItem {
  screen: ScreenName;
  icon: string;
  label: string;
}

const NAV: NavItem[] = [
  { screen: 'settings', icon: '⚙', label: 'General' },
  { screen: 'permissions', icon: '⊟', label: 'Permissions' },
  { screen: 'mcp', icon: '⊞', label: 'MCP Servers' },
  { screen: 'plugins', icon: '⊕', label: 'Plugins' },
  { screen: 'skills', icon: '▤', label: 'Skills' },
  { screen: 'about', icon: 'ⓘ', label: 'About' },
];

interface SettingsLayoutProps {
  active: ScreenName;
  onChange: (screen: ScreenName) => void;
  /** The active screen, rendered as the right-hand pane. */
  children: ReactNode;
}

export function SettingsLayout({ active, onChange, children }: SettingsLayoutProps): JSX.Element {
  return (
    <div className="settings-shell">
      <nav className="set-nav">
        <div className="title">Settings</div>
        {NAV.map((n) => (
          <button
            key={n.screen}
            type="button"
            className={'nav-item' + (active === n.screen ? ' active' : '')}
            onClick={() => onChange(n.screen)}
          >
            <span className="ico">{n.icon}</span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      <div className="set-pane">{children}</div>
    </div>
  );
}
