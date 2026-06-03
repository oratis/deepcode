// Top-level React component for desktop client.
// Spec: docs/VISUAL_DESIGN.html
// Milestone: 0.1.2 — adds project-folder flow + inspector wiring + session refresh.

import { useCallback, useEffect, useState } from 'react';
import { contextWindowFor } from '@deepcode/core/dist/providers/deepseek.js';
import { FilePanel } from './components/FilePanel.js';
import { InspectorPanel } from './components/InspectorPanel.js';
import { InspectorRail } from './components/InspectorRail.js';
import { ProjectPickerOverlay } from './components/ProjectPickerOverlay.js';
import { SETTINGS_FAMILY, SettingsLayout } from './components/SettingsLayout.js';
import { Sidebar } from './components/Sidebar.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { registerShortcut } from './lib/keyboard.js';
import { clearHistory as clearAgentHistory } from './lib/mac-agent.js';
import { loadProjectPath, saveProjectPath } from './lib/project.js';
import { storedToMsgs, type Msg } from './lib/repl-stream.js';
import { onUpdateDownloaded, startUpdaterPolling } from './lib/updater.js';
import { useFilePanel } from './lib/use-file-panel.js';
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
import { emptyInspectorData, type InspectorData } from './types/inspector.js';

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
  // Right side is an activity bar (48 px rail) that's always present; exactly
  // one panel opens to its left at a time (VS Code model). `inspectorOpen`
  // tracks the Inspector panel; the file panel tracks its own tabs + a collapse
  // flag so it can be hidden without discarding open files.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspector, setInspector] = useState<InspectorData>(() => emptyInspectorData());
  // Right-side file panel (§3.11): opens to the left of the rail.
  const fp = useFilePanel();
  const [filesCollapsed, setFilesCollapsed] = useState(false);

  // Drag the panel's left edge to resize (320–800px, persisted by the hook).
  const onFilePanelResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = fp.state.width;
      const move = (ev: MouseEvent): void => fp.setWidth(startW + (startX - ev.clientX));
      const up = (): void => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [fp.state.width, fp.setWidth],
  );

  // Exactly one right panel at a time. Opening one closes the other; clicking
  // an active icon closes its panel.
  const filesVisible = fp.isOpen && !filesCollapsed;

  const toggleInspector = useCallback(() => {
    setFilesCollapsed(true); // a visible inspector hides the file panel
    setInspectorOpen((v) => !v);
  }, []);

  const toggleFiles = useCallback(() => {
    setInspectorOpen(false);
    if (fp.isOpen) setFilesCollapsed((c) => !c);
    else void fp.openViaPicker(); // no tabs yet — let the user pick a file
  }, [fp.isOpen, fp.openViaPicker]);

  // Open a specific file (chat tool card / inspector recent files): surface the
  // file panel and step the inspector aside for it.
  const openFile = useCallback(
    (path: string) => {
      setInspectorOpen(false);
      setFilesCollapsed(false);
      void fp.open(path);
    },
    [fp.open],
  );

  // Merge the slice ReplScreen lifts up (usage / model / mode / files / todos).
  // Stable identity so ReplScreen's sync effect doesn't refire every render.
  const handleInspector = useCallback((patch: Partial<InspectorData>) => {
    setInspector((prev) => ({ ...prev, ...patch }));
  }, []);

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

  // ⌘\ is context-sensitive: when the file panel is showing a diff it toggles
  // split/inline (§3.11); otherwise it expands/collapses the inspector (§3.10a).
  // Re-registered when that context changes so it never reads stale state.
  useEffect(() => {
    return registerShortcut('meta+\\', () => {
      if (filesVisible && fp.state.view === 'diff') fp.toggleDiffMode();
      else toggleInspector();
    });
  }, [filesVisible, fp.state.view, fp.toggleDiffMode, toggleInspector]);

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

  // Main shell: 3-column grid. The right column is a 48 px rail by default and
  // a 320 px panel when expanded — the `inspector-open` modifier widens the
  // grid track so the panel squeezes the chat stream rather than overlaying it.
  const planCount = inspector.todos.filter((t) => t.status !== 'completed').length;
  const usedTokens = inspector.usage.inputTokens + inspector.usage.outputTokens;
  const contextFill = usedTokens > 0 ? usedTokens / contextWindowFor(inspector.model) : undefined;

  // The rail is always the last 48px column. A panel (file OR inspector) opens
  // to its left, widening the grid so it squeezes chat rather than overlaying.
  const inspectorShowing = inspectorOpen && !filesVisible;
  const shellClass =
    'app-shell' + (filesVisible ? ' file-open' : inspectorShowing ? ' inspector-open' : '');

  return (
    <div className={shellClass}>
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
        onSessionRemoved={() => {
          // The active session was archived/deleted — reset to a fresh chat.
          clearAgentHistory();
          setResumedMessages(undefined);
          setActiveSessionId(null);
          setScreen('repl');
          setSessionEpoch((k) => k + 1);
        }}
      />
      <main className="chat-main" key={`main-${sessionEpoch}`}>
        {renderScreen(
          screen,
          setScreen,
          projectPath,
          () => setSessionEpoch((k) => k + 1),
          handleInspector,
          resumedMessages,
          openFile,
        )}
      </main>
      {filesVisible ? (
        <FilePanel
          tabs={fp.state.tabs}
          activeIndex={fp.state.activeIndex}
          view={fp.state.view}
          diffMode={fp.state.diffMode}
          width={fp.state.width}
          onSelectTab={fp.select}
          onCloseTab={fp.close}
          onSelectView={fp.setView}
          onToggleDiffMode={fp.toggleDiffMode}
          onSelectHistory={() => {}}
          onResizeStart={onFilePanelResizeStart}
        />
      ) : inspectorShowing ? (
        <InspectorPanel
          projectPath={projectPath}
          data={inspector}
          focusSection={null}
          onCollapse={() => setInspectorOpen(false)}
          onOpenFile={openFile}
        />
      ) : null}
      <InspectorRail
        inspectorActive={inspectorShowing}
        filesActive={filesVisible}
        settingsActive={SETTINGS_FAMILY.includes(screen)}
        planCount={planCount}
        contextFill={contextFill}
        onToggleInspector={toggleInspector}
        onToggleFiles={toggleFiles}
        onSettings={() => setScreen('settings')}
      />
    </div>
  );
}

function renderScreen(
  screen: ScreenName,
  setScreen: (s: ScreenName) => void,
  projectPath: string,
  onTurnComplete: () => void,
  onInspector: (patch: Partial<InspectorData>) => void,
  initialMessages?: Msg[],
  onOpenFile?: (path: string) => void,
): JSX.Element {
  switch (screen) {
    case 'chat':
      // 'chat' folded into 'repl' — the new shell has only the REPL surface.
      return (
        <ReplScreen
          projectPath={projectPath}
          onTurnComplete={onTurnComplete}
          initialMessages={initialMessages}
          onInspector={onInspector}
          onOpenFile={onOpenFile}
        />
      );
    case 'sessions':
      return <SessionsScreen onPick={() => setScreen('repl')} onNew={() => setScreen('repl')} />;
    // Settings-family screens share the Settings shell's left nav so they're
    // mutually reachable now that the inspector rail no longer routes to them.
    case 'plugins':
    case 'skills':
    case 'permissions':
    case 'mcp':
    case 'settings':
    case 'about':
      return (
        <SettingsLayout active={screen} onChange={setScreen}>
          {renderSettingsPane(screen)}
        </SettingsLayout>
      );
    case 'repl':
    default:
      return (
        <ReplScreen
          projectPath={projectPath}
          onTurnComplete={onTurnComplete}
          initialMessages={initialMessages}
          onInspector={onInspector}
          onOpenFile={onOpenFile}
        />
      );
  }
}

/** The right-hand pane for a settings-family screen (hosted by SettingsLayout). */
function renderSettingsPane(screen: ScreenName): JSX.Element {
  switch (screen) {
    case 'plugins':
      return <PluginsScreen />;
    case 'skills':
      return <SkillsScreen />;
    case 'permissions':
      return <PermissionsScreen />;
    case 'mcp':
      return <MCPManagerScreen />;
    case 'about':
      return <AboutScreen />;
    case 'settings':
    default:
      return <SettingsScreen />;
  }
}
