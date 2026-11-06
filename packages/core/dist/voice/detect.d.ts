import type { VoiceConfig } from '../config/types.js';
/** Binary names searched on PATH when `voice.binPath` is unset, in order. */
export declare const WHISPER_BIN_CANDIDATES: readonly ["whisper-cli", "whisper"];
/** Default model location probed when `voice.modelPath` is unset (under home). */
export declare const DEFAULT_MODEL_RELPATH: readonly [".deepcode", "models", "whisper-base.en.bin"];
/** Filesystem / PATH probes — injectable so detection is deterministic in tests. */
export interface VoiceProbe {
    /** Resolve an executable `name` on PATH to an absolute path, or null. */
    which(name: string): Promise<string | null>;
    /** True if a readable regular file exists at `path`. */
    fileExists(path: string): Promise<boolean>;
    /** Home dir, for ~ expansion + the default model path. */
    home: string;
}
export interface VoiceStatus {
    /** True iff a supported provider, a binary, and a model were all resolved. */
    ready: boolean;
    /** Resolved provider name (defaults to 'whisper.cpp'). */
    provider: string;
    /** Resolved whisper binary (absolute path), if found. */
    binPath?: string;
    /** Resolved model file (absolute path), if found. */
    modelPath?: string;
    /** Human-readable reasons it is not ready (empty when ready). */
    problems: string[];
}
/** Expand a leading `~` / `~/` to the home dir. Other paths pass through. */
export declare function expandHome(p: string, home: string): string;
/**
 * Detect whether local voice input (whisper.cpp) is ready to use.
 *
 * Resolution order:
 *  - binary: `voice.binPath` (if set) else the first of
 *    {@link WHISPER_BIN_CANDIDATES} found on PATH.
 *  - model:  `voice.modelPath` (if set) else the documented default
 *    `~/.deepcode/models/whisper-base.en.bin`.
 *
 * Never throws — every missing/invalid piece becomes a `problems` entry.
 */
export declare function detectVoice(voice: VoiceConfig | undefined, probe?: Partial<VoiceProbe>): Promise<VoiceStatus>;
//# sourceMappingURL=detect.d.ts.map