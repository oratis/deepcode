import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildRecordArgs, detectRecorder, recordToWav } from './record.js';

describe('detectRecorder', () => {
  it('prefers ffmpeg when present', async () => {
    const r = await detectRecorder(async (n) => (n === 'ffmpeg' ? `/usr/bin/${n}` : null));
    expect(r.found).toBe(true);
    expect(r.bin).toBe('ffmpeg');
    expect(r.binPath).toBe('/usr/bin/ffmpeg');
  });

  it('falls back to rec, then sox', async () => {
    const recOnly = await detectRecorder(async (n) => (n === 'rec' ? '/usr/bin/rec' : null));
    expect(recOnly.bin).toBe('rec');
    const soxOnly = await detectRecorder(async (n) => (n === 'sox' ? '/usr/bin/sox' : null));
    expect(soxOnly.bin).toBe('sox');
  });

  it('reports a problem when nothing is installed', async () => {
    const r = await detectRecorder(async () => null);
    expect(r.found).toBe(false);
    expect(r.problems.join('\n')).toMatch(/No microphone recorder/);
  });
});

describe('buildRecordArgs', () => {
  it('ffmpeg uses avfoundation on macOS and 16k mono', () => {
    const a = buildRecordArgs('ffmpeg', '/t/o.wav', { platform: 'darwin', maxSeconds: 60 });
    expect(a).toEqual(
      expect.arrayContaining(['-f', 'avfoundation', '-i', ':default', '-ar', '16000', '-ac', '1']),
    );
    expect(a).toContain('-t');
    expect(a[a.length - 1]).toBe('/t/o.wav');
  });

  it('ffmpeg uses alsa on Linux and honors a custom device', () => {
    const a = buildRecordArgs('ffmpeg', '/t/o.wav', { platform: 'linux', device: 'hw:1' });
    expect(a).toEqual(expect.arrayContaining(['-f', 'alsa', '-i', 'hw:1']));
  });

  it('ffmpeg throws on an unsupported platform without a device', () => {
    expect(() => buildRecordArgs('ffmpeg', '/t/o.wav', { platform: 'win32' })).toThrow(
      /inputDevice/,
    );
  });

  it('rec records the default device (no -d); sox adds -d', () => {
    const rec = buildRecordArgs('rec', '/t/o.wav', { maxSeconds: 30 });
    expect(rec).not.toContain('-d');
    expect(rec).toEqual(
      expect.arrayContaining(['-r', '16000', '-c', '1', '/t/o.wav', 'trim', '0', '30']),
    );
    const sox = buildRecordArgs('sox', '/t/o.wav');
    expect(sox).toContain('-d');
  });
});

/** Fake ChildProcess whose stderr emits `err` then close(code) on next tick. */
function fakeChild(code: number, err = ''): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess;
  const stderr = new EventEmitter() as unknown as NodeJS.ReadableStream;
  Object.defineProperty(ee, 'stderr', { value: stderr });
  let killed = false;
  (ee as unknown as { kill: (s?: string) => boolean }).kill = () => {
    killed = true;
    // Emulate ffmpeg/sox finalizing + exiting on SIGINT.
    setImmediate(() => ee.emit('close', code));
    return true;
  };
  setImmediate(() => {
    if (err) (stderr as unknown as EventEmitter).emit('data', Buffer.from(err));
    if (!killed) ee.emit('close', code); // self-exit path (no abort)
  });
  return ee;
}

describe('recordToWav', () => {
  it('resolves when stopped via the abort signal (non-zero exit is expected)', async () => {
    const ac = new AbortController();
    const exec = (() => fakeChild(255)) as unknown as RecordExec;
    const p = recordToWav({
      outPath: '/t/o.wav',
      bin: 'ffmpeg',
      binPath: '/usr/bin/ffmpeg',
      platform: 'darwin',
      signal: ac.signal,
      exec,
    });
    ac.abort();
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects on a non-zero exit when not aborted (e.g. no mic)', async () => {
    const exec = (() => fakeChild(1, 'No such audio device')) as unknown as RecordExec;
    await expect(
      recordToWav({ outPath: '/t/o.wav', bin: 'rec', binPath: '/usr/bin/rec', exec }),
    ).rejects.toThrow(/rec exited 1: No such audio device/);
  });
});

type RecordExec = NonNullable<Parameters<typeof recordToWav>[0]['exec']>;
