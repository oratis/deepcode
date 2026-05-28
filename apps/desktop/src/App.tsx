// Top-level React component for desktop client.
// Spec: docs/VISUAL_DESIGN.html
// Milestone: M6-rest — Onboarding gate + Nav + 9 screens

import { useEffect, useState } from 'react';
import { Nav, type ScreenName } from './components/Nav.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { AboutScreen } from './screens/About.js';
import { ChatScreen } from './screens/Chat.js';
import { MCPManagerScreen } from './screens/MCPManager.js';
import { OnboardingScreen } from './screens/Onboarding.js';
import { PermissionsScreen } from './screens/Permissions.js';
import { PluginsScreen } from './screens/Plugins.js';
import { ReplScreen } from './screens/Repl.js';
import { SessionsScreen } from './screens/Sessions.js';
import { SettingsScreen } from './screens/Settings.js';
import { SkillsScreen } from './screens/Skills.js';
import type { UpdateInfo } from './types/global.js';

export function App(): JSX.Element {
  const [version, setVersion] = useState<string>('');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [screen, setScreen] = useState<ScreenName>('repl');

  useEffect(() => {
    void window.deepcode.version().then(setVersion);
    void window.deepcode.creds.load().then((c) => setHasKey(c.hasKey));
    const off = window.deepcode.onUpdateDownloaded((info) => setUpdate(info));
    return () => off();
  }, []);

  if (hasKey === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-fg">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      {update && <UpdateBanner info={update} />}
      <header className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
        <span className="font-semibold">DeepCode</span>
        <span className="text-muted">v{version}</span>
      </header>
      {hasKey && <Nav active={screen} onChange={setScreen} />}
      <main className="flex-1 overflow-hidden">
        {!hasKey ? (
          <OnboardingScreen onComplete={() => setHasKey(true)} />
        ) : (
          renderScreen(screen, setScreen)
        )}
      </main>
    </div>
  );
}

function renderScreen(
  screen: ScreenName,
  setScreen: (s: ScreenName) => void,
): JSX.Element {
  switch (screen) {
    case 'chat':
      return <ChatScreen />;
    case 'sessions':
      return (
        <SessionsScreen onPick={() => setScreen('repl')} onNew={() => setScreen('repl')} />
      );
    case 'plugins':
      return <PluginsScreen />;
    case 'skills':
      return <SkillsScreen />;
    case 'permissions':
      return <PermissionsScreen />;
    case 'mcp':
      return <MCPManagerScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'about':
      return <AboutScreen />;
    case 'repl':
    default:
      return <ReplScreen />;
  }
}
