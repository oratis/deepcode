// Renderer side of voice input — thin wrappers over the Rust voice_* commands
// (apps/desktop/src-tauri/src/voice.rs) plus a pure transcript-insertion helper.
// The whole record → transcribe flow runs natively; the renderer just toggles it.

import { invoke } from '@tauri-apps/api/core';

export interface VoiceStatus {
  ready: boolean;
  binPath: string | null;
  modelPath: string | null;
  recorderPath: string | null;
  problems: string[];
}

/** Is whisper.cpp + a model + ffmpeg installed/configured? */
export async function voiceStatus(): Promise<VoiceStatus> {
  return invoke('voice_status');
}

/** Begin recording from the default mic. Rejects if voice isn't set up. */
export async function voiceStart(): Promise<void> {
  await invoke('voice_start');
}

/** Stop recording and return the locally-transcribed text. */
export async function voiceStop(): Promise<string> {
  return invoke('voice_stop');
}

/** Abort an in-flight recording without transcribing. */
export async function voiceCancel(): Promise<void> {
  await invoke('voice_cancel');
}

/**
 * Splice `text` into `value` at the cursor, adding a single space separator when
 * needed. Pure — returns the new value and the caret position after the inserted
 * text. Used to drop a transcript into the composer without clobbering what's
 * already typed.
 */
export function insertTranscript(
  value: string,
  cursor: number,
  text: string,
): { value: string; caret: number } {
  const pos = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, pos);
  const after = value.slice(pos);
  const needsLead = before.length > 0 && !/\s$/.test(before);
  const lead = needsLead ? ' ' : '';
  const insert = lead + text;
  return { value: before + insert + after, caret: pos + insert.length };
}
