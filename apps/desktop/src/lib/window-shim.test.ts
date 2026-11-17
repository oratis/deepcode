import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadSnapshot } from '@deepcode/protocol';
import { installTauriShim } from './window-shim.js';
import {
  archiveProtocolThread,
  deleteProtocolThread,
  listProtocolThreads,
  resumeProtocolThread,
} from './protocol-agent.js';
import {
  listPlugins,
  listSessions,
  sessionArchive,
  sessionDelete,
  sessionRead,
} from './tauri-api.js';

vi.mock('./protocol-agent.js');
vi.mock('./tauri-api.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', {});
  installTauriShim();
});
afterEach(() => vi.unstubAllGlobals());

describe('renderer session ownership', () => {
  it.each([
    ['archive', archiveProtocolThread, sessionArchive],
    ['delete', deleteProtocolThread, sessionDelete],
  ] as const)(
    'does not fall back to a local %s when the session owner rejects it',
    async (action, host, legacy) => {
      vi.mocked(host).mockRejectedValueOnce(new Error('Thread has an active writer'));
      await expect(window.deepcode.sessions[action]({ id: 'owned' })).rejects.toThrow(
        'active writer',
      );
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['archive', archiveProtocolThread, sessionArchive],
    ['delete', deleteProtocolThread, sessionDelete],
  ] as const)(
    'uses the legacy %s only when the host explicitly lacks the capability',
    async (action, host, legacy) => {
      vi.mocked(host).mockResolvedValueOnce(false);
      await window.deepcode.sessions[action]({ id: 'legacy' });
      expect(legacy).toHaveBeenCalledWith('legacy');
    },
  );

  it('resumes a protocol snapshot without depending on a legacy file', async () => {
    const snapshot: ThreadSnapshot = {
      id: 'journal-thread',
      cwd: '/workspace',
      createdAt: '',
      updatedAt: '',
      turns: [
        {
          id: 'turn',
          threadId: 'journal-thread',
          status: 'completed',
          startedAt: '',
          items: [
            { id: 'message', type: 'user_message', completedAt: '', payload: { text: 'hello' } },
          ],
        },
      ],
    };
    vi.mocked(resumeProtocolThread).mockImplementationOnce(async (_id, prepare) => {
      await prepare?.(snapshot);
      return snapshot;
    });
    await expect(window.deepcode.sessions.resume({ id: snapshot.id })).resolves.toEqual({
      history: [],
      sessionId: snapshot.id,
      thread: snapshot,
    });
    expect(sessionRead).not.toHaveBeenCalled();
  });

  it('surfaces plugin discovery failure instead of claiming an empty installation', async () => {
    vi.mocked(listPlugins).mockRejectedValueOnce(new Error('Manifest read failed'));
    await expect(window.deepcode.plugins.list()).rejects.toThrow('Manifest read failed');
  });
});

it('reports journal/index failures instead of hiding them with the v1 fallback', async () => {
  vi.mocked(listProtocolThreads).mockRejectedValueOnce(
    new Error('Committed journal checksum mismatch'),
  );
  await expect(window.deepcode.sessions.list()).rejects.toThrow('checksum');
  expect(listSessions).not.toHaveBeenCalled();
});
it('uses the v1 index only when the sidecar lacks thread management', async () => {
  vi.mocked(listProtocolThreads).mockResolvedValueOnce(null);
  vi.mocked(listSessions).mockResolvedValueOnce([]);
  expect(await window.deepcode.sessions.list()).toEqual([]);
  expect(listSessions).toHaveBeenCalledOnce();
});
