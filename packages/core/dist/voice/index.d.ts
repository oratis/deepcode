import { spawn } from 'node:child_process';
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
export declare class WhisperCppProvider implements VoiceProvider {
    private readonly opts;
    readonly name = "whisper.cpp";
    constructor(opts: WhisperCppOpts);
    transcribe(audioPath: string, opts?: TranscribeOpts): Promise<VoiceTranscript>;
}
/**
 * Strip whisper.cpp's leading log lines and per-line timestamps to get the
 * raw transcript. Public so tests can pin format details.
 */
export declare function parseWhisperOutput(raw: string): string;
export declare class StubVoiceProvider implements VoiceProvider {
    readonly name = "stub";
    transcribe(): Promise<VoiceTranscript>;
}
export { detectVoice, expandHome, WHISPER_BIN_CANDIDATES, DEFAULT_MODEL_RELPATH, type VoiceProbe, type VoiceStatus, } from './detect.js';
export { detectRecorder, recordToWav, buildRecordArgs, RECORDER_CANDIDATES, type RecorderBin, type RecorderStatus, type RecordToWavOpts, type RecordArgsOpts, } from './record.js';
//# sourceMappingURL=index.d.ts.map