// Top-level React component for desktop client.
// Spec: docs/VISUAL_DESIGN.html
// Milestone: 0.1.1 — design-aligned 3-column shell

import { useEffect, useState } from 'react';
import { InspectorRail } from './components/InspectorRail.js';
import { Sidebar } from './components/Sidebar.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { onUpdateDownloaded, startUpdaterPolling } from './lib/updater.js';
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
import type { ScreenName } from './components/Nav.js';
import type { UpdateInfo } from './types/global.js';

export function App(): JSX.Element {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [screen, setScreen] = useState<ScreenName>('repl');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    void window.deepcode.creds.load().then((c) => setHasKey(c.hasKey));
    const offShim = window.deepcode.onUpdateDownloaded((info) => setUpdate(info));
    const offReal = onUpdateDownloaded((info) => setUpdate(info));
    startUpdaterPolling();
    return () => {
      offShim();
      offReal();
    };
  }, []);

  if (hasKey === null) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-2)',
          background: 'var(--bg-0)',
        }}
      >
        Loading…
      </div>
    );
  }

  // Pre-onboarding: standalone hero — no shell.
  if (!hasKey) {
    return <OnboardingScreen onComplete={() => setHasKey(true)} />;
  }

  // Main shell: 3-column grid.
  return (
    <div className="app-shell">
      {update && <UpdateBanner info={update} />}
      <Sidebar
        activeSessionId={activeSessionId}
        onPickSession={(id) => {
          setActiveSessionId(id);
          setScreen('repl');
        }}
        onNewSession={() => {
          setActiveSessionId(null);
          setScreen('repl');
        }}
      />
      <main className="chat-main">{renderScreen(screen, setScreen)}</main>
      <InspectorRail
        activeScreen={screen}
        onChange={(s) => setScreen(s)}
        contextFill={undefined}
      />
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
        <div className="legacy-screen">
          <SessionsScreen
            onPick={() => setScreen('repl')}
            onNew={() => setScreen('repl')}
          />
        </div>
      );
    case 'plugins':
      return (
        <div className="legacy-screen">
          <PluginsScreen />
        </div>
      );
    case 'skills':
      return (
        <div className="legacy-screen">
          <SkillsScreen />
        </div>
      );
    case 'permissions':
      return (
        <div className="legacy-screen">
          <PermissionsScreen />
        </div>
      );
    case 'mcp':
      return (
        <div className="legacy-screen">
          <MCPManagerScreen />
        </div>
      );
    case 'settings':
      return (
        <div className="legacy-screen">
          <SettingsScreen />
        </div>
      );
    case 'about':
      return (
        <div className="legacy-screen">
          <AboutScreen />
        </div>
      );
    case 'repl':
    default:
      return <ReplScreen />;
  }
}
