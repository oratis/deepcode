// Data plumbing for the Changes panel: fetch the working-tree diff over the
// protocol, and collect review findings/actions from the agent event bus.
//
// Subscribes to the bus directly rather than threading events through the REPL
// screen — findings must outlive the turn that produced them, and the panel is
// a sibling of the chat, not a child.

import { useCallback, useEffect, useReducer, useState } from 'react';
import type { WorkspaceDiffResult } from '@deepcode/protocol';
import { applyReviewFindings, getWorkspaceDiff, revertReviewAction } from './protocol-agent.js';
import {
  changesReducer,
  initialChangesState,
  type ChangedFile,
  type ChangesState,
  type ChangesEvent,
  type ReviewFinding,
} from './changes-reducer.js';

export interface UseChanges {
  state: ChangesState;
  refresh: () => Promise<void>;
  toggleFile: (path: string) => void;
  apply: (findings: ReviewFinding[]) => Promise<boolean>;
  revert: (actionId: string) => Promise<boolean>;
  clear: () => void;
  /** Seed findings/actions carried by a resumed thread. */
  adopt: (items: {
    findings: Record<string, unknown>[];
    actions: Record<string, unknown>[];
  }) => void;
}

interface BusEvent {
  kind?: string;
  type?: string;
  [key: string]: unknown;
}

/** A session switch invalidates pending reads; within a session the newest refresh wins. */
export class ChangesDiffRequests {
  private generation = 0;
  private latestRequest = 0;

  constructor(
    private readonly read: () => Promise<WorkspaceDiffResult>,
    private readonly dispatch: (event: ChangesEvent) => void,
  ) {}

  capture(): number {
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  invalidate(): void {
    this.generation++;
  }

  clear(): void {
    this.invalidate();
    this.dispatch({ type: 'cleared' });
  }

  async refresh(): Promise<void> {
    const generation = this.generation;
    const request = ++this.latestRequest;
    const current = () => this.isCurrent(generation) && request === this.latestRequest;
    this.dispatch({ type: 'diff-requested' });
    try {
      const result = await this.read();
      if (!current()) return;
      this.dispatch({
        type: 'diff-loaded',
        repository: result.repository,
        files: result.files as unknown as ChangedFile[],
        truncated: result.truncated,
      });
    } catch (err) {
      if (!current()) return;
      this.dispatch({ type: 'diff-failed', message: (err as Error).message ?? String(err) });
    }
  }
}

export function useChanges(): UseChanges {
  const [state, dispatch] = useReducer(changesReducer, initialChangesState);
  const [requests] = useState(() => new ChangesDiffRequests(getWorkspaceDiff, dispatch));

  const refresh = useCallback(() => requests.refresh(), [requests]);

  useEffect(() => () => requests.invalidate(), [requests]);

  const apply = useCallback(
    async (findings: ReviewFinding[]) => {
      if (findings.length === 0) return false;
      const generation = requests.capture();
      const findingIds = findings.map((f) => f.findingId);
      dispatch({ type: 'apply-started', findingIds });
      try {
        // One batched turn, not one per finding: review/apply takes a list, and
        // the app-server allows a single active turn per thread.
        await applyReviewFindings(findings);
      } catch (err) {
        if (!requests.isCurrent(generation)) return false;
        dispatch({ type: 'diff-failed', message: (err as Error).message ?? String(err) });
        dispatch({ type: 'apply-settled', findingIds });
        return false;
      }
      // The apply runs as a normal turn; its review_action arrives on the bus.
      // Refresh so the working-tree list reflects what it wrote.
      if (requests.isCurrent(generation)) void refresh();
      return true;
    },
    [refresh, requests],
  );

  const revert = useCallback(
    async (actionId: string) => {
      const generation = requests.capture();
      try {
        await revertReviewAction(actionId);
      } catch (err) {
        if (!requests.isCurrent(generation)) return false;
        dispatch({ type: 'diff-failed', message: (err as Error).message ?? String(err) });
        return false;
      }
      if (requests.isCurrent(generation)) void refresh();
      return true;
    },
    [refresh, requests],
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
  const clear = useCallback(() => requests.clear(), [requests]);

  // Resuming replays the thread's review items so the panel shows what the
  // conversation already found, not an empty list over a repo full of changes.
  const adopt = useCallback(
    (items: { findings: Record<string, unknown>[]; actions: Record<string, unknown>[] }) => {
      requests.clear();
      for (const finding of items.findings) {
        dispatch({ type: 'finding', finding: finding as unknown as ReviewFinding });
      }
      for (const action of items.actions) {
        dispatch({
          type: 'action',
          action: {
            actionId: String(action.actionId ?? ''),
            findingIds: Array.isArray(action.findingIds) ? action.findingIds.map(String) : [],
            kind: action.kind === 'revert' ? 'revert' : 'apply',
          },
        });
      }
    },
    [requests],
  );

  return { state, refresh, toggleFile, apply, revert, clear, adopt };
}
