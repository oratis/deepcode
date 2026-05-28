// Electron main process entry.
// Spec: docs/DEVELOPMENT_PLAN.md §4 + §4b (auto-update)
// Milestone: M6 — skeleton: window creation, IPC bridge, electron-updater stub
//
// This file is intentionally minimal for the skeleton PR. It wires:
//   · Single BrowserWindow with the renderer's HTML
//   · IPC channels for credentials / settings / agent control
//   · electron-updater hook (lazy-loaded; gracefully no-ops if pkg not present)
//
// Full feature wiring (terminal, file panel, 11 screens) lands in subsequent
// M6-rest PRs.

import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  CredentialsStore,
  SessionManager,
  discoverPlugins,
  loadSettings,
  loadSkills,
  resolveCredentials,
  VERSION,
} from '@deepcode/core';
import { promises as fs } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e0e10',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    // Vite dev server (configured to run on 5173 — see scripts/run-dev.sh)
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// IPC handlers — renderer asks main for things it can't do (fs, creds, etc.)
// ──────────────────────────────────────────────────────────────────────────

ipcMain.handle('app:version', () => VERSION);

ipcMain.handle('creds:load', async () => {
  const store = new CredentialsStore();
  const creds = await resolveCredentials({ store });
  return {
    hasKey: !!(creds.apiKey || creds.authToken),
    baseURL: creds.baseURL,
  };
});

ipcMain.handle('creds:save', async (_event, args: { apiKey: string; baseURL?: string }) => {
  const store = new CredentialsStore();
  await store.save({ apiKey: args.apiKey, baseURL: args.baseURL });
  return true;
});

ipcMain.handle('settings:load', async () => {
  const { merged } = await loadSettings({ cwd: process.cwd(), home: homedir() });
  return merged;
});

// ──────────────────────────────────────────────────────────────────────────
// M6-rest IPC handlers — list sessions / plugins / skills / mcp
// ──────────────────────────────────────────────────────────────────────────

ipcMain.handle('sessions:list', async (_event, args: { limit?: number } = {}) => {
  const sm = new SessionManager();
  const all = await sm.list();
  return all.slice(0, args.limit ?? 50);
});

ipcMain.handle('plugins:list', async () => {
  const { plugins, hashMismatches } = await discoverPlugins({ home: homedir() });
  return plugins.map((p) => ({
    name: p.manifest.name,
    version: p.manifest.version,
    enabled: p.enabled,
    sourceHash: p.sourceHash,
    trustedBy: 'user', // proper trust map lookup belongs here once exposed
    contributedHookEvents: Object.keys(p.manifest.contributes?.hooks ?? {}),
    warning: hashMismatches.find((m) => m.startsWith(p.manifest.name)),
  }));
});

ipcMain.handle('mcp:list', async () => {
  // The actual MCP connect happens once the agent loop boots; here we surface
  // the configured servers from settings as 'disabled' until then.
  const { merged } = await loadSettings({ cwd: process.cwd(), home: homedir() });
  const servers = merged.mcpServers ?? {};
  return Object.keys(servers).map((name) => ({ name, status: 'disabled' as const }));
});

ipcMain.handle('skills:list', async () => {
  const skills = await loadSkills({ cwd: process.cwd(), home: homedir() });
  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    source: s.source,
    path: s.path,
  }));
});

ipcMain.handle('skills:body', async (_event, args: { path: string }) => {
  try {
    return await fs.readFile(args.path, 'utf8');
  } catch (err) {
    return `(error reading skill body: ${(err as Error).message})`;
  }
});

// ──────────────────────────────────────────────────────────────────────────
// electron-updater — lazy import so the skeleton works without the dep
// ──────────────────────────────────────────────────────────────────────────

async function setupAutoUpdater(): Promise<void> {
  if (isDev) return;
  try {
    const mod = await import('electron-updater').catch(() => null);
    if (!mod) return;
    const { autoUpdater } = mod;
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      /* silent: no releases yet / offline */
    });
    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('updater:update-downloaded', {
        version: info.version,
        releaseNotes: info.releaseNotes,
      });
    });
  } catch {
    /* electron-updater not installed yet — fine for skeleton */
  }
}

// ──────────────────────────────────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await createWindow();
  await setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
