// Microphone capture — spawns a local recorder (ffmpeg or sox) to write a
// 16 kHz mono WAV that whisper.cpp can transcribe. Like the whisper binary,
// the recorder is a user-installed external tool we detect on PATH and, if
// absent, print setup steps for. Spec: docs/VOICE_INPUT.md.

import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Recorder front-ends we look for, in preference order. `ffmpeg` is the most
 * universally installed; `rec` / `sox` are whisper.cpp tutorial favorites and
 * pick the default input device automatically.
 */
export const RECORDER_CANDIDATES = ['ffmpeg', 'rec', 'sox'] as const;
export type RecorderBin = (typeof RECORDER_CANDIDATES)[number];

export interface RecorderStatus {
  /** True if a usable recorder was found on PATH. */
  found: boolean;
  /** Which front-end was selected. */
  bin?: RecorderBin;
  /** Absolute path to the recorder binary. */
  binPath?: string;
  /** Human-readable reason none was found (empty when found). */
  problems: string[];
}

/** PATH/`which` probe — injectable for tests. */
export type WhichFn = (name: string) => Promise<string | null>;

async function whichOnPath(name: string): Promise<string | null> {
  const dirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, name);
    try {
      await access(candidate, FS.X_OK);
      return candidate;
    } catch {
      /* not here, or not executable */
    }
  }
  return null;
}

/** Find the first available recorder front-end on PATH. Never throws. */
export async function detectRecorder(which: WhichFn = whichOnPath): Promise<RecorderStatus> {
  for (const bin of RECORDER_CANDIDATES) {
    const binPath = await which(bin);
    if (binPath) return { found: true, bin, binPath, problems: [] };
  }
  return {
    found: false,
    problems: [
      `No microphone recorder found on PATH (looked for ${RECORDER_CANDIDATES.join(', ')}).`,
    ],
  };
}

export interface RecordArgsOpts {
  /** Platform, for ffmpeg's OS-specific input format. Defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Override the input device (ffmpeg only). Default: ':default' (mac) / 'default' (linux). */
  device?: string;
  /** Hard cap on recording length in seconds (safety net). */
  maxSeconds?: number;
}

/**
 * Build the recorder argv for `bin` writing 16 kHz mono WAV to `outPath`.
 * Pure + exported so the per-platform/per-tool command is unit-testable.
 *
 * - ffmpeg: needs an OS-specific input (avfoundation on macOS, alsa on Linux).
 * - rec / sox: capture the system default input device directly.
 */
export function buildRecordArgs(
  bin: RecorderBin,
  outPath: string,
  opts: RecordArgsOpts = {},
): string[] {
  const platform = opts.platform ?? process.platform;
  const max = opts.maxSeconds;

  if (bin === 'ffmpeg') {
    const input: string[] =
      platform === 'darwin'
        ? ['-f', 'avfoundation', '-i', opts.device ?? ':default']
        : platform === 'linux'
          ? ['-f', 'alsa', '-i', opts.device ?? 'default']
          : (() => {
              throw new Error(
                `ffmpeg mic capture on ${platform} needs an explicit voice.inputDevice; install sox (rec) or set one.`,
              );
            })();
    const dur = max ? ['-t', String(max)] : [];
    // -y overwrite, quiet logs, 16 kHz mono PCM WAV (what whisper.cpp expects).
    return [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...input,
      ...dur,
      '-ar',
      '16000',
      '-ac',
      '1',
      outPath,
    ];
  }

  // sox family. `rec OUT` == `sox -d OUT`; both grab the default input device.
  const head = bin === 'rec' ? ['-q'] : ['-q', '-d'];
  const trim = max ? ['trim', '0', String(max)] : [];
  return [...head, '-r', '16000', '-c', '1', outPath, ...trim];
}

export interface RecordToWavOpts {
  outPath: string;
  bin: RecorderBin;
  binPath: string;
  /** Abort to stop recording (the normal "user pressed Enter" path). */
  signal?: AbortSignal;
  /** Override spawn for tests. */
  exec?: typeof spawn;
  platform?: NodeJS.Platform;
  device?: string;
  maxSeconds?: number;
}

/**
 * Record from the default mic into `outPath` until `signal` aborts (or the
 * recorder exits / hits `maxSeconds`). Aborting sends SIGINT so ffmpeg/sox
 * flush a valid WAV trailer; a non-zero exit *after* an abort is expected and
 * resolves cleanly. A non-zero exit *without* an abort (e.g. no microphone)
 * rejects with the recorder's stderr.
 */
export function recordToWav(opts: RecordToWavOpts): Promise<void> {
  const spawnFn = opts.exec ?? spawn;
  const args = buildRecordArgs(opts.bin, opts.outPath, {
    platform: opts.platform,
    device: opts.device,
    maxSeconds: opts.maxSeconds ?? 60,
  });
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawnFn(opts.binPath, args);
    let stderr = '';
    let aborted = false;
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (aborted || code === 0) resolve();
      else reject(new Error(`${opts.bin} exited ${code}: ${stderr.slice(0, 300).trim()}`));
    });
    if (opts.signal) {
      if (opts.signal.aborted) stop();
      else opts.signal.addEventListener('abort', stop, { once: true });
    }
    function stop(): void {
      aborted = true;
      try {
        child.kill('SIGINT'); // ffmpeg/sox finalize the WAV on SIGINT
      } catch {
        /* already exited */
      }
    }
  });
}
