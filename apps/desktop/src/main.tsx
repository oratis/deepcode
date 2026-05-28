// React renderer entry — mounts <App/> into #root.
// Spec: docs/VISUAL_DESIGN.html screens #1-#11
// Milestone: M6 (Tauri runtime)

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { installTauriShim } from './lib/window-shim.js';
import { App } from './App.js';
import './index.css';

// Install the window.deepcode adapter so the existing screens that call
// window.deepcode.* keep working — the adapter forwards to Tauri commands.
installTauriShim();

// Surface unhandled promise rejections + global errors with a visible alert
// so the user sees "DeepCode hit X" instead of a frozen UI.
window.addEventListener('unhandledrejection', (e) => {
  console.error('[DeepCode] Unhandled promise rejection:', e.reason);
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found');
createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
