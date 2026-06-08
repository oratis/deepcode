// React hook driving the composer's 🎙 voice button. A small state machine —
// idle → recording → transcribing → idle — over the native voice_* commands.
// `onTranscript` receives the final text so the composer can splice it in.

import { useCallback, useEffect, useRef, useState } from 'react';
import { voiceCancel, voiceStart, voiceStatus, voiceStop } from './voice.js';

export type VoiceState = 'idle' | 'recording' | 'transcribing';

export interface UseVoice {
  state: VoiceState;
  /** null until the status probe resolves; then whether voice is set up. */
  available: boolean | null;
  /** Setup problems from the status probe (for a tooltip when unavailable). */
  problems: string[];
  /** Last error (start/stop failure), or null. */
  error: string | null;
  /** idle → start recording; recording → stop + transcribe. No-op while busy. */
  toggle: () => void;
  /** Abort an in-flight recording without transcribing. */
  cancel: () => void;
}

export function useVoice(onTranscript: (text: string) => void): UseVoice {
  const [state, setState] = useState<VoiceState>('idle');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    voiceStatus()
      .then((s) => {
        if (!live) return;
        setAvailable(s.ready);
        setProblems(s.problems);
      })
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, []);

  const toggle = useCallback(() => {
    if (busy.current) return;
    setError(null);
    if (state === 'idle') {
      busy.current = true;
      void voiceStart()
        .then(() => setState('recording'))
        .catch((e: unknown) => setError(String(e)))
        .finally(() => (busy.current = false));
    } else if (state === 'recording') {
      busy.current = true;
      setState('transcribing');
      void voiceStop()
        .then((text) => {
          const t = text.trim();
          if (t) onTranscript(t);
        })
        .catch((e: unknown) => setError(String(e)))
        .finally(() => {
          setState('idle');
          busy.current = false;
        });
    }
  }, [state, onTranscript]);

  const cancel = useCallback(() => {
    if (state === 'idle') return;
    void voiceCancel().finally(() => setState('idle'));
  }, [state]);

  return { state, available, problems, error, toggle, cancel };
}
