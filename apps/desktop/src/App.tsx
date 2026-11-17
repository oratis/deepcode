// Top-level React component for desktop client.
// Spec: docs/VISUAL_DESIGN.html
// Milestone: 0.1.2 — adds project-folder flow + inspector wiring + session refresh.

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { contextWindowFor } from '@deepcode/core/dist/providers/model-metadata.js';
import { ChangesPanel } from './components/ChangesPanel.js';
import { FilePanel } from './components/FilePanel.js';
import { InspectorPanel } from './components/InspectorPanel.js';
import { InspectorRail } from './components/InspectorRail.js';
import { ProjectPickerOverlay } from './components/ProjectPickerOverlay.js';
import { SETTINGS_FAMILY, SettingsLayout } from './components/SettingsLayout.js';
import { Sidebar } from './components/Sidebar.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import { registerShortcut } from './lib/keyboard.js';
import { clearProtocolThread as clearAgentHistory } from './lib/protocol-agent.js';
import { loadProjectPath, saveProjectPath } from './lib/project.js';
import {
  storedToMsgs,
  threadReviewItems,
  threadToMsgs,
  type Msg,
  type ThreadLike,
} from './lib/repl-stream.js';
import { onUpdateDownloaded, startUpdaterPolling } from './lib/updater.js';
import { changesBadge } from './lib/changes-reducer.js';
import { useChanges } from './lib/use-changes.js';
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
  const [turnBusy, setTurnBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [reviewStarting, setReviewStarting] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadEpoch, setLoadEpoch] = useState(0);
  const switchingRef = useRef(false);
  const turnBusyRef = useRef(false);
  const mutationBusyRef = useRef(false);
  const reviewStartingRef = useRef(false);
  const reviewRequestRef = useRef<object | null>(null);
  const navigationLocked = turnBusy || switching || mutationBusy || reviewStarting;
  const isNavigationLocked = useCallback(
    () =>
      turnBusyRef.current ||
      switchingRef.current ||
      mutationBusyRef.current ||
      reviewStartingRef.current,
    [],
  );
  const handleTurnBusyChange = useCallback((busy: boolean) => {
    turnBusyRef.current = busy;
    setTurnBusy(busy);
    // Once a turn event arrives, its lifecycle owns the lock. Diff refreshes
    // can outlive the start request and must not disable approvals or Stop.
    reviewRequestRef.current = null;
    reviewStartingRef.current = false;
    setReviewStarting(false);
  }, []);
  const handleMutationBusyChange = useCallback((busy: boolean) => {
    mutationBusyRef.current = busy;
    setMutationBusy(busy);
  }, []);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Sidebar refreshes must not remount the active REPL: a completed turn is
  // persisted asynchronously and refreshing the session list used to erase
  // the just-streamed transcript. Only explicit session/project transitions
  // advance the REPL epoch.
  const [sidebarEpoch, setSidebarEpoch] = useState(0);
  const [replEpoch, setReplEpoch] = useState(0);
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
  // Changes panel (§ review): findings + working-tree diff, same right slot.
  const changes = useChanges();
  const [changesOpen, setChangesOpen] = useState(false);

  // Review actions start ordinary turns. Claim the same lock as Send before
  // awaiting the RPC, including the gap before turn.started is delivered.
  async function runReview(action: () => Promise<boolean>): Promise<void> {
    if (isNavigationLocked()) return;
    const request = {};
    reviewRequestRef.current = request;
    reviewStartingRef.current = true;
    setReviewStarting(true);
    let started = false;
    try {
      started = await action();
    } finally {
      // Successful starts stay locked until the buffered turn.started event;
      // failed requests have no turn lifecycle to release their lock.
      if (!started && reviewRequestRef.current === request) {
        reviewRequestRef.current = null;
        reviewStartingRef.current = false;
        setReviewStarting(false);
      }
    }
  }

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
    setChangesOpen(false);
    setInspectorOpen((v) => !v);
  }, []);

  const toggleFiles = useCallback(() => {
    setInspectorOpen(false);
    setChangesOpen(false);
    if (fp.isOpen) setFilesCollapsed((c) => !c);
    else void fp.openViaPicker(); // no tabs yet — let the user pick a file
  }, [fp.isOpen, fp.openViaPicker]);

  const toggleChanges = useCallback(() => {
    setInspectorOpen(false);
    setFilesCollapsed(true);
    setChangesOpen((open) => {
      // Load on open rather than on mount: the diff is a Git call, and an
      // unopened panel shouldn't pay for it.
      if (!open) void changes.refresh();
      return !open;
    });
  }, [changes.refresh]);

  // Open a specific file (chat tool card / inspector recent files): surface the
  // file panel and step the inspector aside for it.
  const openFile = useCallback(
    (path: string) => {
      setInspectorOpen(false);
      setChangesOpen(false);
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

  const resetSession = useCallback(() => {
    clearAgentHistory();
    setNavigationError(null);
    setResumedMessages(undefined);
    setActiveSessionId(null);
    setScreen('repl');
    setInspector(emptyInspectorData());
    changes.clear();
    setSidebarEpoch((k) => k + 1);
    setReplEpoch((k) => k + 1);
  }, [changes.clear]);

  const startNewSession = useCallback(() => {
    if (isNavigationLocked()) return;
    resetSession();
  }, [resetSession, isNavigationLocked]);

  async function resumeSession(id: string): Promise<void> {
    if (isNavigationLocked()) return;
    if (id === activeSessionId) {
      setScreen('repl');
      return;
    }
    switchingRef.current = true;
    setSwitching(true);
    setNavigationError(null);
    try {
      const { history, thread } = await window.deepcode.sessions.resume({ id });
      const snapshot = thread as (ThreadLike & { cwd?: string }) | undefined;
      const hasItems = (snapshot?.turns ?? []).some((turn) => turn.items.length > 0);
      setResumedMessages(
        hasItems
          ? threadToMsgs(snapshot!)
          : storedToMsgs(history as Parameters<typeof storedToMsgs>[0]),
      );
      changes.clear();
      if (snapshot) changes.adopt(threadReviewItems(snapshot));
      if (snapshot?.cwd) setProjectPath(snapshot.cwd);
      setInspector(emptyInspectorData());
      setActiveSessionId(id);
      setScreen('repl');
      setReplEpoch((k) => k + 1);
    } catch (error) {
      setNavigationError(
        `Could not open session: ${String(error)}. Your current conversation is still open.`,
      );
    } finally {
      switchingRef.current = false;
      setSwitching(false);
    }
  }

  useEffect(() => {
    setLoadError(null);
    void Promise.all([window.deepcode.creds.load(), loadProjectPath()])
      .then(([credentials, path]) => {
        setHasKey(credentials.hasKey);
        setProjectPath(path ?? null);
      })
      .catch((error) => setLoadError(String(error)));
  }, [loadEpoch]);

  useEffect(() => {
    const offShim = window.deepcode.onUpdateDownloaded((info) => setUpdate(info));
    const offReal = onUpdateDownloaded((info) => setUpdate(info));
    startUpdaterPolling();
    const offN = registerShortcut('meta+n', startNewSession);
    const offComma = registerShortcut('meta+,', () => setScreen('settings'));
    const offSlash = registerShortcut('meta+/', () => setScreen('about'));

    return () => {
      offShim();
      offReal();
      offN();
      offComma();
      offSlash();
    };
  }, [startNewSession]);

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

  if (loadError)
    return (
      <div className="app-load-error" role="alert">
        <h1>Could not open DeepCode</h1>
        <p>{loadError}</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setLoadEpoch((value) => value + 1)}
        >
          Retry
        </button>
      </div>
    );

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

  // The rail is always the last 64px column. A panel (file OR inspector) opens
  // to its left, widening the grid so it squeezes chat rather than overlaying.
  const changesShowing = changesOpen && !filesVisible;
  const inspectorShowing = inspectorOpen && !filesVisible && !changesShowing;
  // The Changes panel reuses the file panel's wider grid track — it shows diff
  // hunks and needs the same room.
  const shellClass =
    'app-shell' +
    (filesVisible || changesShowing ? ' file-open' : inspectorShowing ? ' inspector-open' : '');
  // Name of the right-side panel currently showing — surfaced in the otherwise
  // empty macOS titlebar strip so the rail toggles gain a visible, labeled echo.
  const activePanelName = filesVisible
    ? 'Files'
    : changesShowing
      ? 'Changes'
      : inspectorShowing
        ? 'Inspector'
        : null;

  return (
    <div className={shellClass}>
      {activePanelName && (
        <div className="titlebar-status" aria-hidden="true">
          {activePanelName}
        </div>
      )}
      {update && <UpdateBanner info={update} />}
      <Sidebar
        key={`sb-${sidebarEpoch}`}
        projectPath={projectPath}
        activeSessionId={activeSessionId}
        navigationLocked={navigationLocked}
        onMutationBusyChange={handleMutationBusyChange}
        onBrowseSessions={() => setScreen('sessions')}
        onPickSession={resumeSession}
        onNewSession={startNewSession}
        onSwitchProject={() => {
          if (isNavigationLocked()) return;
          startNewSession();
          setProjectPath(null);
        }}
        onSessionRemoved={resetSession}
      />
      <main className="chat-main" aria-label="DeepCode workspace">
        {navigationError && (
          <div className="navigation-error" role="alert">
            {navigationError}
            <button
              type="button"
              onClick={() => setNavigationError(null)}
              aria-label="Dismiss session error"
            >
              ×
            </button>
          </div>
        )}
        {screen !== 'repl' && (
          <div className="workspace-back">
            <button type="button" onClick={() => setScreen('repl')}>
              ← Back to conversation
            </button>
            {turnBusy && <span role="status">A turn is active · return to respond or stop</span>}
          </div>
        )}
        <div
          className="conversation-view"
          inert={switching || mutationBusy || reviewStarting}
          hidden={screen !== 'repl'}
          key={`repl-${replEpoch}`}
        >
          <ReplScreen
            projectPath={projectPath}
            onNavigate={setScreen}
            onTurnComplete={() => setSidebarEpoch((value) => value + 1)}
            onSessionStarted={setActiveSessionId}
            onNewSession={startNewSession}
            initialMessages={resumedMessages}
            onInspector={handleInspector}
            onOpenFile={openFile}
            onBusyChange={handleTurnBusyChange}
          />
        </div>
        {screen === 'sessions' && (
          <SessionsScreen
            projectPath={projectPath}
            activeSessionId={activeSessionId}
            navigationLocked={navigationLocked}
            onPick={resumeSession}
            onNew={startNewSession}
          />
        )}
        {SETTINGS_FAMILY.includes(screen) && (
          <SettingsLayout active={screen} onChange={setScreen}>
            {renderSettingsPane(screen)}
          </SettingsLayout>
        )}
      </main>
      {changesShowing ? (
        <ChangesPanel
          state={changes.state}
          actionsDisabled={navigationLocked}
          width={fp.state.width}
          onRefresh={() => void changes.refresh()}
          onToggleFile={changes.toggleFile}
          onApply={(findings) => void runReview(() => changes.apply(findings))}
          onRevert={(actionId) => void runReview(() => changes.revert(actionId))}
          onOpenFile={openFile}
          onResizeStart={onFilePanelResizeStart}
        />
      ) : filesVisible ? (
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
          onSelectHistory={fp.selectHistory}
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
        changesActive={changesShowing}
        settingsActive={SETTINGS_FAMILY.includes(screen)}
        planCount={planCount}
        contextFill={contextFill}
        changesCount={changesBadge(changes.state)}
        onToggleInspector={toggleInspector}
        onToggleFiles={toggleFiles}
        onToggleChanges={toggleChanges}
        onSettings={() => setScreen('settings')}
      />
    </div>
  );
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
