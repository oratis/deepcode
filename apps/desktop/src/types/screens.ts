// The canonical list of top-level screens the app shell can navigate to.
// Imported by App.tsx (renderScreen switch) and InspectorRail.tsx (button
// routing). Update both sites when adding a new screen.

export type ScreenName =
  | 'repl'
  | 'chat' // alias for 'repl' — kept for IPC-shim backwards compat
  | 'sessions'
  | 'plugins'
  | 'skills'
  | 'permissions'
  | 'mcp'
  | 'settings'
  | 'about';
