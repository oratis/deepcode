import { spawn } from 'node:child_process';
/**
 * Recorder front-ends we look for, in preference order. `ffmpeg` is the most
 * universally installed; `rec` / `sox` are whisper.cpp tutorial favorites and
 * pick the default input device automatically.
 */
export declare const RECORDER_CANDIDATES: readonly ["ffmpeg", "rec", "sox"];
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
/** Find the first available recorder front-end on PATH. Never throws. */
export declare function detectRecorder(which?: WhichFn): Promise<RecorderStatus>;
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
export declare function buildRecordArgs(bin: RecorderBin, outPath: string, opts?: RecordArgsOpts): string[];
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
export declare function recordToWav(opts: RecordToWavOpts): Promise<void>;
//# sourceMappingURL=record.d.ts.map