import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionListEntry } from '../types/global.js';

/** Both navigation surfaces use the existing host-owned session index. */
export function useSessionList(
  refreshKey?: string | null,
  pollMs?: number,
): {
  sessions: SessionListEntry[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const activeRequests = useRef(0);
  const mounted = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    if (!mounted.current) return;
    const request = ++requestSequence.current;
    activeRequests.current += 1;
    try {
      const rows = await window.deepcode.sessions.list();
      if (request !== requestSequence.current) return;
      setSessions(rows);
      setError(null);
    } catch (cause) {
      if (request !== requestSequence.current) return;
      // A refresh failure must not erase the last useful index.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      activeRequests.current -= 1;
      if (request === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    // Polls must not supersede a slow in-flight response indefinitely. A
    // deliberate refresh can still replace a request after a session action.
    const timer = pollMs
      ? setInterval(() => {
          if (activeRequests.current === 0) void reload();
        }, pollMs)
      : undefined;
    return () => {
      if (timer) clearInterval(timer);
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, [reload, refreshKey, pollMs]);

  return { sessions, loading, error, reload };
}
