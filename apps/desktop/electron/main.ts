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
  loadSettings,
  resolveCredentials,
  VERSION,
} from '@deepcode/core';

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
