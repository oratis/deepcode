// React renderer entry — mounts <App/> into #root.
// Spec: docs/VISUAL_DESIGN.html screens #1-#11
// Milestone: M6 (Tauri runtime)

import React from 'react';
import { createRoot } from 'react-dom/client';
import { installTauriShim } from './lib/window-shim.js';
import { App } from './App.js';
import './index.css';

// Install the window.deepcode adapter so the existing screens that call
// window.deepcode.* keep working — the adapter forwards to Tauri commands.
installTauriShim();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found');
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
