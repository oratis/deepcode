// React renderer entry — mounts <App/> into #root.
// Spec: docs/VISUAL_DESIGN.html screens #1-#11
// Milestone: M6 skeleton

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found');
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
