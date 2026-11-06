import type { Interface as ReadlineInterface } from 'node:readline/promises';
import type { Writable } from 'node:stream';
import { type DeepCodeSettings } from '@deepcode/core';
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
export declare function captureVoice(deps: VoiceCaptureDeps): Promise<VoiceCaptureResult>;
//# sourceMappingURL=voice-capture.d.ts.map