// Top-level React component for desktop client.
// Spec: docs/VISUAL_DESIGN.html
// Milestone: M6 skeleton — onboarding + REPL placeholder + update banner

import { useEffect, useState } from 'react';
import { OnboardingScreen } from './screens/Onboarding.js';
import { ReplScreen } from './screens/Repl.js';
import { UpdateBanner } from './components/UpdateBanner.js';
import type { UpdateInfo } from './types/global.js';

export function App(): JSX.Element {
  const [version, setVersion] = useState<string>('');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

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
      <main className="flex-1 overflow-hidden">
        {!hasKey ? (
          <OnboardingScreen onComplete={() => setHasKey(true)} />
        ) : (
          <ReplScreen />
        )}
      </main>
    </div>
  );
}
