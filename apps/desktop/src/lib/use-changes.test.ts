import type { WorkspaceDiffResult } from '@deepcode/protocol';
import { describe, expect, it } from 'vitest';
import { ChangesDiffRequests } from './use-changes.js';
import { changesReducer, initialChangesState, type ChangesState } from './changes-reducer.js';

function deferred() {
  let resolve!: (result: WorkspaceDiffResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<WorkspaceDiffResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function diff(path: string): WorkspaceDiffResult {
  return {
    repository: true,
    base: 'HEAD',
    truncated: false,
    files: [
      {
        path,
        status: 'modified',
        additions: 1,
        deletions: 0,
        binary: false,
        truncated: false,
        hunks: [],
      },
    ],
  };
}

function setup(read: () => Promise<WorkspaceDiffResult>) {
  let state: ChangesState = { ...initialChangesState };
  const requests = new ChangesDiffRequests(read, (event) => {
    state = changesReducer(state, event);
  });
  return { requests, state: () => state };
}

describe('Changes panel request scope', () => {
  it('does not repopulate a cleared session with a late diff from the previous workspace', async () => {
    const old = deferred();
    const s = setup(() => old.promise);
    const request = s.requests.refresh();
    expect(s.state().loading).toBe(true);
    s.requests.clear(); // Both new-session and adopt use this boundary.
    old.resolve(diff('old-workspace/private.ts'));
    await request;
    expect(s.state()).toEqual(initialChangesState);
  });

  it('ignores old failures after adopting a new session and preserves its successful diff', async () => {
    const old = deferred();
    const next = deferred();
    let count = 0;
    const s = setup(() => (count++ === 0 ? old.promise : next.promise));
    const oldRequest = s.requests.refresh();
    s.requests.clear();
    const nextRequest = s.requests.refresh();
    next.resolve(diff('new-workspace/index.ts'));
    await nextRequest;
    old.reject(new Error('Previous workspace is unavailable'));
    await oldRequest;
    expect(s.state().files?.map((file) => file.path)).toEqual(['new-workspace/index.ts']);
    expect(s.state().error).toBeNull();
    expect(s.state().loading).toBe(false);
  });

  it('keeps the latest refresh when two requests complete out of order in the same session', async () => {
    const earlier = deferred();
    const latest = deferred();
    let count = 0;
    const s = setup(() => (count++ === 0 ? earlier.promise : latest.promise));
    const oldRequest = s.requests.refresh();
    const newRequest = s.requests.refresh();
    latest.resolve(diff('latest.ts'));
    await newRequest;
    earlier.resolve(diff('stale.ts'));
    await oldRequest;
    expect(s.state().files?.map((file) => file.path)).toEqual(['latest.ts']);
  });

  it('does not let an older failure clear the loading status of the newest request', async () => {
    const earlier = deferred();
    const latest = deferred();
    let count = 0;
    const s = setup(() => (count++ === 0 ? earlier.promise : latest.promise));
    const oldRequest = s.requests.refresh();
    const newRequest = s.requests.refresh();
    earlier.reject(new Error('old failure'));
    await oldRequest;
    expect(s.state().loading).toBe(true);
    expect(s.state().error).toBeNull();
    latest.reject(new Error('current failure'));
    await newRequest;
    expect(s.state().loading).toBe(false);
    expect(s.state().error).toBe('current failure');
  });

  it('invalidates pending updates on teardown and old action continuations on session switches', async () => {
    const pending = deferred();
    const s = setup(() => pending.promise);
    const actionGeneration = s.requests.capture();
    const request = s.requests.refresh();
    s.requests.invalidate();
    expect(s.requests.isCurrent(actionGeneration)).toBe(false);
    pending.resolve(diff('unmounted.ts'));
    await request;
    expect(s.state().files).toBeNull();
  });
});
