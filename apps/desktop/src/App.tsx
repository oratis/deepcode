// Top-level React component for desktop client.
// Spec: docs/VISUAL_DESIGN.html
// Milestone: 0.1.2 — adds project-folder flow + inspector wiring + session refresh.

import { useEffect, useState } from 'react';
import { InspectorRail } from './components/InspectorRail.js';
import { ProjectPickerOverlay } from './components/ProjectPickerOverlay.js';
import { Sidebar } from './components/Sidebar.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { registerShortcut } from './lib/keyboard.js';
import { clearHistory as clearAgentHistory } from './lib/mac-agent.js';
import { loadProjectPath, saveProjectPath } from './lib/project.js';
import { storedToMsgs, type Msg } from './lib/repl-stream.js';
import { onUpdateDownloaded, startUpdaterPolling } from './lib/updater.js';
import { AboutScreen } from './screens/About.js';
import { MCPManagerScreen } from './screens/MCPManager.js';
import { OnboardingScreen } from './screens/Onboarding.js';
import { PermissionsScreen } from './screens/Permissions.js';
import { PluginsScreen } from './screens/Plugins.js';
import { ReplScreen } from './screens/Repl.js';
import { SessionsScreen } from './screens/Sessions.js';
import { SettingsScreen } from './screens/Settings.js';
import { SkillsScreen } from './screens/Skills.js';
import type { ScreenName } from './types/screens.js';
import type { UpdateInfo } from './types/global.js';

export function App(): JSX.Element {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [projectPath, setProjectPath] = useState<string | null | undefined>(undefined);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [screen, setScreen] = useState<ScreenName>('repl');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  // Reconstructed messages for a resumed session; seeded into ReplScreen on its
  // next remount. Cleared when starting a fresh session.
  const [resumedMessages, setResumedMessages] = useState<Msg[] | undefined>(undefined);

  useEffect(() => {
    void window.deepcode.creds.load().then((c) => setHasKey(c.hasKey));
    void loadProjectPath().then((p) => setProjectPath(p ?? null));
    const offShim = window.deepcode.onUpdateDownloaded((info) => setUpdate(info));
    const offReal = onUpdateDownloaded((info) => setUpdate(info));
    startUpdaterPolling();

    // Global keyboard shortcuts that mirror the sidebar hints.
    const offN = registerShortcut('meta+n', () => {
      clearAgentHistory();
      setResumedMessages(undefined);
      setActiveSessionId(null);
      setScreen('repl');
      setSessionEpoch((k) => k + 1);
    });
    const offComma = registerShortcut('meta+,', () => setScreen('settings'));
    const offSlash = registerShortcut('meta+/', () => setScreen('about'));

    return () => {
      offShim();
      offReal();
      offN();
      offComma();
      offSlash();
    };
  }, []);

  async function handlePickProject(path: string): Promise<void> {
    await saveProjectPath(path);
    setProjectPath(path);
  }

  // Loading state
  if (hasKey === null || projectPath === undefined) {
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

  // No project picked yet → folder picker overlay
  if (!projectPath) {
    return <ProjectPickerOverlay onPicked={handlePickProject} />;
  }

  // Main shell: 3-column grid.
  return (
    <div className="app-shell">
      {update && <UpdateBanner info={update} />}
      <Sidebar
        key={`sb-${sessionEpoch}`}
        projectPath={projectPath}
        activeSessionId={activeSessionId}
        onPickSession={async (id) => {
          // Load the session's stored messages, adopt them into the agent, and
          // remount ReplScreen seeded with the reconstructed conversation.
          try {
            const { history } = await window.deepcode.sessions.resume({ id });
            setResumedMessages(storedToMsgs(history as Parameters<typeof storedToMsgs>[0]));
          } catch {
            setResumedMessages(undefined); // fall back to a fresh view
          }
          setActiveSessionId(id);
          setScreen('repl');
          setSessionEpoch((k) => k + 1);
        }}
        onNewSession={() => {
          clearAgentHistory();
          setResumedMessages(undefined);
          setActiveSessionId(null);
          setScreen('repl');
          // Force ReplScreen to remount with a clean message history
          setSessionEpoch((k) => k + 1);
        }}
        onSwitchProject={async () => {
          // Force-show the picker again by clearing state. Also clear
          // the in-memory conversation so the next session starts
          // fresh in the new project's cwd.
          clearAgentHistory();
          setResumedMessages(undefined);
          setProjectPath(null);
          setActiveSessionId(null);
          setSessionEpoch((k) => k + 1);
        }}
      />
      <main className="chat-main" key={`main-${sessionEpoch}`}>
        {renderScreen(
          screen,
          setScreen,
          projectPath,
          () => setSessionEpoch((k) => k + 1),
          resumedMessages,
        )}
      </main>
      <InspectorRail activeScreen={screen} onChange={(s) => setScreen(s)} contextFill={undefined} />
    </div>
  );
}

function renderScreen(
  screen: ScreenName,
  setScreen: (s: ScreenName) => void,
  projectPath: string,
  onTurnComplete: () => void,
  initialMessages?: Msg[],
): JSX.Element {
  switch (screen) {
    case 'chat':
      // 'chat' folded into 'repl' — the new shell has only the REPL surface.
      return (
        <ReplScreen
          projectPath={projectPath}
          onTurnComplete={onTurnComplete}
          initialMessages={initialMessages}
        />
      );
    case 'sessions':
      return <SessionsScreen onPick={() => setScreen('repl')} onNew={() => setScreen('repl')} />;
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
      return (
        <ReplScreen
          projectPath={projectPath}
          onTurnComplete={onTurnComplete}
          initialMessages={initialMessages}
        />
      );
  }
}
