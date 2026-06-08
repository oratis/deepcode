// Interactive voice capture for the REPL: detect whisper.cpp + a recorder,
// record from the mic until the user presses Enter, transcribe locally, and
// return the text so the REPL can pre-fill the input line. The audio file is
// written to $TMPDIR and deleted right after transcription (see VOICE_INPUT.md).

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Interface as ReadlineInterface } from 'node:readline/promises';
import type { Writable } from 'node:stream';
import {
  detectRecorder,
  detectVoice,
  recordToWav,
  WhisperCppProvider,
  type DeepCodeSettings,
} from '@deepcode/core';
import { voiceSetupLines } from './commands.js';

export interface VoiceCaptureDeps {
  rl: ReadlineInterface;
  output: Writable;
  settings: DeepCodeSettings;
  /** Home override (honors --home), for the default model-path probe. */
  home?: string;
}

export interface VoiceCaptureResult {
  /** Transcribed text, or null on cancel / not-ready / empty / error. */
  transcript: string | null;
  /** Lines for the REPL to print (status, errors, or setup steps). */
  lines: string[];
}

export async function captureVoice(deps: VoiceCaptureDeps): Promise<VoiceCaptureResult> {
  const { rl, output, settings, home } = deps;

  const status = await detectVoice(settings.voice, { home });
  if (!status.ready) return { transcript: null, lines: voiceSetupLines(status) };

  const rec = await detectRecorder();
  if (!rec.found || !rec.bin || !rec.binPath) {
    return {
      transcript: null,
      lines: [
        '🎙  whisper.cpp is ready, but no microphone recorder was found.',
        `  • ${rec.problems[0] ?? 'no recorder on PATH'}`,
        '  Install one:  brew install ffmpeg   ·   brew install sox',
      ],
    };
  }

  const wav = join(tmpdir(), `deepcode-voice-${randomUUID()}.wav`);
  const cleanup = async (): Promise<void> => {
    await rm(wav, { force: true });
    await rm(`${wav}.txt`, { force: true }); // whisper --output-txt side-file
  };

  // Record until the user presses Enter (abort → SIGINT → recorder flushes WAV).
  const ac = new AbortController();
  let recErr: Error | undefined;
  const recording = recordToWav({
    outPath: wav,
    bin: rec.bin,
    binPath: rec.binPath,
    signal: ac.signal,
    device: settings.voice?.inputDevice,
  }).catch((e: unknown) => {
    recErr = e as Error;
  });

  output.write(`  🎙 Recording with ${rec.bin}… press Enter to stop.\n`);
  await rl.question('');
  ac.abort();
  await recording;

  if (recErr) {
    await cleanup();
    return {
      transcript: null,
      lines: [`  ⚠ Recording failed: ${recErr.message}`, '  Run `/voice setup` for help.'],
    };
  }

  try {
    output.write('  … transcribing locally\n');
    const provider = new WhisperCppProvider({
      binPath: status.binPath,
      modelPath: status.modelPath!,
    });
    const { text } = await provider.transcribe(wav);
    await cleanup();
    const transcript = text.trim();
    if (!transcript) {
      return { transcript: null, lines: ['  (No speech detected — nothing inserted.)'] };
    }
    return {
      transcript,
      lines: [
        `  🎙 Transcribed (${transcript.length} chars) — review the input line, edit, then press Enter.`,
      ],
    };
  } catch (e) {
    await cleanup();
    return { transcript: null, lines: [`  ⚠ Transcription failed: ${(e as Error).message}`] };
  }
}
