// Data plumbing for the Changes panel: fetch the working-tree diff over the
// protocol, and collect review findings/actions from the agent event bus.
//
// Subscribes to the bus directly rather than threading events through the REPL
// screen — findings must outlive the turn that produced them, and the panel is
// a sibling of the chat, not a child.

import { useCallback, useEffect, useReducer } from 'react';
import { applyReviewFindings, getWorkspaceDiff, revertReviewAction } from './protocol-agent.js';
import {
  changesReducer,
  initialChangesState,
  type ChangedFile,
  type ChangesState,
  type ReviewFinding,
} from './changes-reducer.js';

export interface UseChanges {
  state: ChangesState;
  refresh: () => Promise<void>;
  toggleFile: (path: string) => void;
  apply: (findings: ReviewFinding[]) => Promise<void>;
  revert: (actionId: string) => Promise<void>;
  clear: () => void;
}

interface BusEvent {
  kind?: string;
  type?: string;
  [key: string]: unknown;
}

export function useChanges(): UseChanges {
  const [state, dispatch] = useReducer(changesReducer, initialChangesState);

  const refresh = useCallback(async () => {
    dispatch({ type: 'diff-requested' });
    try {
      const result = await getWorkspaceDiff();
      dispatch({
        type: 'diff-loaded',
        repository: result.repository,
        files: result.files as unknown as ChangedFile[],
        truncated: result.truncated,
      });
    } catch (err) {
      dispatch({ type: 'diff-failed', message: (err as Error).message ?? String(err) });
    }
  }, []);

  const apply = useCallback(
    async (findings: ReviewFinding[]) => {
      if (findings.length === 0) return;
      const findingIds = findings.map((f) => f.findingId);
      dispatch({ type: 'apply-started', findingIds });
      try {
        // One batched turn, not one per finding: review/apply takes a list, and
        // the app-server allows a single active turn per thread.
        await applyReviewFindings(findings);
      } catch (err) {
        dispatch({ type: 'diff-failed', message: (err as Error).message ?? String(err) });
        dispatch({ type: 'apply-settled', findingIds });
      }
      // The apply runs as a normal turn; its review_action arrives on the bus.
      // Refresh so the working-tree list reflects what it wrote.
      await refresh();
    },
    [refresh],
  );

  const revert = useCallback(
    async (actionId: string) => {
      try {
        await revertReviewAction(actionId);
      } catch (err) {
        dispatch({ type: 'diff-failed', message: (err as Error).message ?? String(err) });
      }
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    return window.deepcode.agent.onEvent((raw) => {
      const event = raw as BusEvent;
      if (event.kind !== 'event') return;
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      if (event.type === 'review_finding') {
        dispatch({ type: 'finding', finding: payload as unknown as ReviewFinding });
      } else if (event.type === 'review_action') {
        dispatch({
          type: 'action',
          action: {
            actionId: String(payload.actionId ?? ''),
            findingIds: Array.isArray(payload.findingIds) ? payload.findingIds.map(String) : [],
            kind: payload.kind === 'revert' ? 'revert' : 'apply',
          },
        });
      }
    });
  }, []);

  const toggleFile = useCallback((path: string) => dispatch({ type: 'toggle-file', path }), []);
  const clear = useCallback(() => dispatch({ type: 'cleared' }), []);

  return { state, refresh, toggleFile, apply, revert, clear };
}
