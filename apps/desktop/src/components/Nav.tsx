// Top nav — switches between the main screens.
// Spec: docs/VISUAL_DESIGN.html screen #1 header
// Milestone: M6-rest

export type ScreenName =
  | 'repl'
  | 'chat'
  | 'sessions'
  | 'plugins'
  | 'skills'
  | 'permissions'
  | 'mcp'
  | 'settings'
  | 'about';

interface NavProps {
  active: ScreenName;
  onChange: (next: ScreenName) => void;
}

const ITEMS: Array<{ name: ScreenName; label: string }> = [
  { name: 'repl', label: 'REPL' },
  { name: 'chat', label: 'Chat' },
  { name: 'sessions', label: 'Sessions' },
  { name: 'plugins', label: 'Plugins' },
  { name: 'skills', label: 'Skills' },
  { name: 'permissions', label: 'Permissions' },
  { name: 'mcp', label: 'MCP' },
  { name: 'settings', label: 'Settings' },
  { name: 'about', label: 'About' },
];

export function Nav({ active, onChange }: NavProps): JSX.Element {
  return (
    <nav className="flex gap-1 border-b border-border bg-bg-elevated px-2 text-sm">
      {ITEMS.map((item) => (
        <button
          key={item.name}
          onClick={() => onChange(item.name)}
          className={
            'px-3 py-2 ' +
            (active === item.name
              ? 'border-b-2 border-accent text-fg'
              : 'text-muted hover:text-fg')
          }
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
