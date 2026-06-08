// voice.ts — IPC wrapper command names (mirrors tauri-api.test.ts) + the pure
// transcript-insertion helper. `invoke` is mocked so no Tauri runtime is needed.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { insertTranscript, voiceCancel, voiceStart, voiceStatus, voiceStop } from './voice.js';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

beforeEach(() => invokeMock.mockReset());

describe('voice IPC wrappers', () => {
  it('call the matching voice_* commands', async () => {
    invokeMock.mockResolvedValue(undefined);
    await voiceStart();
    expect(invokeMock).toHaveBeenCalledWith('voice_start');
    await voiceCancel();
    expect(invokeMock).toHaveBeenCalledWith('voice_cancel');

    invokeMock.mockResolvedValue('hello there');
    expect(await voiceStop()).toBe('hello there');
    expect(invokeMock).toHaveBeenCalledWith('voice_stop');

    invokeMock.mockResolvedValue({ ready: true, problems: [] });
    const s = await voiceStatus();
    expect(invokeMock).toHaveBeenCalledWith('voice_status');
    expect(s.ready).toBe(true);
  });
});

describe('insertTranscript', () => {
  it('inserts into an empty composer without a leading space', () => {
    expect(insertTranscript('', 0, 'hello world')).toEqual({ value: 'hello world', caret: 11 });
  });

  it('adds a single space when the preceding char is not whitespace', () => {
    const r = insertTranscript('write a', 7, 'function');
    expect(r.value).toBe('write a function');
    expect(r.caret).toBe('write a function'.length);
  });

  it('does not double-space after existing whitespace', () => {
    expect(insertTranscript('write ', 6, 'tests').value).toBe('write tests');
    expect(insertTranscript('line\n', 5, 'two').value).toBe('line\ntwo');
  });

  it('splices at the cursor, keeping the tail', () => {
    const r = insertTranscript('abXY', 2, 'foo'); // cursor between "ab" and "XY"
    expect(r.value).toBe('ab fooXY');
    expect(r.caret).toBe('ab foo'.length);
  });

  it('clamps an out-of-range cursor to the end', () => {
    expect(insertTranscript('ab', 99, 'c').value).toBe('ab c');
  });
});
