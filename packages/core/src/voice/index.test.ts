import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseWhisperOutput, StubVoiceProvider, WhisperCppProvider } from './index.js';

describe('parseWhisperOutput', () => {
  it('strips per-line timestamps', () => {
    const raw =
      '[00:00:00.000 --> 00:00:02.500]  hello world\n' +
      '[00:00:02.500 --> 00:00:05.000]  another line';
    expect(parseWhisperOutput(raw)).toBe('hello world another line');
  });

  it('drops whisper_ log lines and system_info', () => {
    const raw =
      'whisper_init_from_file: loading\n' +
      'system_info: AVX2\n' +
      '[00:00:00.000 --> 00:00:01.000]  real text';
    expect(parseWhisperOutput(raw)).toBe('real text');
  });

  it('returns empty string on log-only input', () => {
    expect(parseWhisperOutput('whisper_init\nsystem_info: X')).toBe('');
  });
});

describe('StubVoiceProvider', () => {
  it('returns empty transcript', async () => {
    const r = await new StubVoiceProvider().transcribe();
    expect(r.text).toBe('');
    expect(r.latencyMs).toBe(0);
  });
});

describe('WhisperCppProvider', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dc-voice-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('throws when audio file does not exist', async () => {
    const p = new WhisperCppProvider({ modelPath: '/no/such/model.bin' });
    await expect(p.transcribe('/no/such/audio.wav')).rejects.toThrow();
  });

  it('uses a custom spawn function and parses its stdout', async () => {
    const audioPath = join(dir, 'a.wav');
    await fs.writeFile(audioPath, ''); // empty placeholder
    // Fake spawn that returns a synthetic whisper stdout
    const fakeSpawn = (() => {
      const ee = new EventEmitter() as unknown as import('node:child_process').ChildProcess;
      const stdout = new EventEmitter() as unknown as NodeJS.ReadableStream;
      const stderr = new EventEmitter() as unknown as NodeJS.ReadableStream;
      Object.defineProperty(ee, 'stdout', { value: stdout });
      Object.defineProperty(ee, 'stderr', { value: stderr });
      setImmediate(() => {
        (stdout as unknown as EventEmitter).emit(
          'data',
          Buffer.from('[00:00:00.000 --> 00:00:01.000]  hello'),
        );
        ee.emit('close', 0);
      });
      return ee;
    }) as unknown as typeof import('node:child_process').spawn;
    const p = new WhisperCppProvider({ modelPath: 'fake', exec: fakeSpawn });
    const r = await p.transcribe(audioPath);
    expect(r.text).toBe('hello');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('throws when whisper exits non-zero', async () => {
    const audioPath = join(dir, 'a.wav');
    await fs.writeFile(audioPath, '');
    const fakeSpawn = (() => {
      const ee = new EventEmitter() as unknown as import('node:child_process').ChildProcess;
      const stdout = new EventEmitter() as unknown as NodeJS.ReadableStream;
      const stderr = new EventEmitter() as unknown as NodeJS.ReadableStream;
      Object.defineProperty(ee, 'stdout', { value: stdout });
      Object.defineProperty(ee, 'stderr', { value: stderr });
      setImmediate(() => {
        (stderr as unknown as EventEmitter).emit('data', Buffer.from('model not found'));
        ee.emit('close', 1);
      });
      return ee;
    }) as unknown as typeof import('node:child_process').spawn;
    const p = new WhisperCppProvider({ modelPath: 'fake', exec: fakeSpawn });
    await expect(p.transcribe(audioPath)).rejects.toThrow(/exited 1/);
  });
});
