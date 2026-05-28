// Voice input subsystem — wraps a local Whisper.cpp model for ASR.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 (M8)
//
// This is the abstraction layer; the actual whisper.cpp binary install +
// model download is left to the user. Pluggable VoiceProvider lets us
// swap in cloud APIs or a different local engine later.

import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';

export interface VoiceTranscript {
  /** Transcribed text. */
  text: string;
  /** Detected language code (e.g. 'en', 'zh'). Optional — whisper can guess. */
  language?: string;
  /** Audio duration in seconds. */
  durationSec?: number;
  /** Time the transcription took. */
  latencyMs: number;
}

export interface VoiceProvider {
  readonly name: string;
  /** Transcribe the audio at `audioPath` (typically a .wav file). */
  transcribe(audioPath: string, opts?: TranscribeOpts): Promise<VoiceTranscript>;
}

export interface TranscribeOpts {
  /** Force a language (skip auto-detect). */
  language?: string;
  /** Abort the transcription. */
  signal?: AbortSignal;
}

// ──────────────────────────────────────────────────────────────────────────
// whisper.cpp provider — calls the `whisper` CLI
// ──────────────────────────────────────────────────────────────────────────

export interface WhisperCppOpts {
  /** Path to the whisper CLI binary. Defaults to `whisper` on PATH. */
  binPath?: string;
  /** Path to the model file. Required. */
  modelPath: string;
  /** Working dir for the CLI. */
  cwd?: string;
  /** Override exec for tests. */
  exec?: typeof spawn;
}

export class WhisperCppProvider implements VoiceProvider {
  readonly name = 'whisper.cpp';
  constructor(private readonly opts: WhisperCppOpts) {}

  async transcribe(audioPath: string, opts: TranscribeOpts = {}): Promise<VoiceTranscript> {
    await fs.access(audioPath); // throws if missing
    const t0 = Date.now();
    const args = ['-m', this.opts.modelPath, '-f', audioPath, '--output-txt'];
    if (opts.language) args.push('-l', opts.language);
    const bin = this.opts.binPath ?? 'whisper';
    const spawnFn = this.opts.exec ?? spawn;
    const { stdout, stderr, code } = await runCommand(spawnFn, bin, args, this.opts.cwd, opts.signal);
    const latency = Date.now() - t0;
    if (code !== 0) {
      throw new Error(`whisper.cpp exited ${code}: ${stderr.slice(0, 300)}`);
    }
    return {
      text: parseWhisperOutput(stdout),
      language: opts.language,
      latencyMs: latency,
    };
  }
}

function runCommand(
  spawnFn: typeof spawn,
  bin: string,
  args: string[],
  cwd: string | undefined,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const p: ChildProcess = spawnFn(bin, args, { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
    p.stderr?.on('data', (c: Buffer) => (stderr += c.toString()));
    p.on('error', reject);
    p.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    if (signal) {
      signal.addEventListener('abort', () => {
        try {
          p.kill('SIGTERM');
        } catch {
          /* already dead */
        }
      });
    }
  });
}

/**
 * Strip whisper.cpp's leading log lines and per-line timestamps to get the
 * raw transcript. Public so tests can pin format details.
 */
export function parseWhisperOutput(raw: string): string {
  const lines = raw.split('\n');
  // whisper.cpp emits `[00:00:00.000 --> 00:00:01.234]  text...`
  const tsRe = /^\[\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}\]\s*/;
  const parts: string[] = [];
  for (const line of lines) {
    const m = tsRe.exec(line);
    if (m) {
      parts.push(line.slice(m[0].length).trim());
    } else if (line.trim() && !line.startsWith('whisper_') && !line.startsWith('system_info:')) {
      // Plain text line not matching the timestamp prefix — include only
      // if it doesn't look like a log message.
      if (parts.length > 0 || /\w/.test(line)) parts.push(line.trim());
    }
  }
  return parts.filter(Boolean).join(' ').trim();
}

// ──────────────────────────────────────────────────────────────────────────
// Stub provider — returns empty transcript. Useful in tests + when no
// engine is configured.
// ──────────────────────────────────────────────────────────────────────────

export class StubVoiceProvider implements VoiceProvider {
  readonly name = 'stub';
  async transcribe(): Promise<VoiceTranscript> {
    return { text: '', latencyMs: 0 };
  }
}
