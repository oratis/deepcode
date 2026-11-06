// Voice input subsystem — wraps a local Whisper.cpp model for ASR.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15 (M8)
//
// This is the abstraction layer; the actual whisper.cpp binary install +
// model download is left to the user. Pluggable VoiceProvider lets us
// swap in cloud APIs or a different local engine later.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
export class WhisperCppProvider {
    opts;
    name = 'whisper.cpp';
    constructor(opts) {
        this.opts = opts;
    }
    async transcribe(audioPath, opts = {}) {
        await fs.access(audioPath); // throws if missing
        const t0 = Date.now();
        const args = ['-m', this.opts.modelPath, '-f', audioPath, '--output-txt'];
        if (opts.language)
            args.push('-l', opts.language);
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
function runCommand(spawnFn, bin, args, cwd, signal) {
    return new Promise((resolve, reject) => {
        const p = spawnFn(bin, args, { cwd });
        let stdout = '';
        let stderr = '';
        p.stdout?.on('data', (c) => (stdout += c.toString()));
        p.stderr?.on('data', (c) => (stderr += c.toString()));
        p.on('error', reject);
        p.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
        if (signal) {
            signal.addEventListener('abort', () => {
                try {
                    p.kill('SIGTERM');
                }
                catch {
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
export function parseWhisperOutput(raw) {
    const lines = raw.split('\n');
    // whisper.cpp emits `[00:00:00.000 --> 00:00:01.234]  text...`
    const tsRe = /^\[\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}\]\s*/;
    const parts = [];
    for (const line of lines) {
        const m = tsRe.exec(line);
        if (m) {
            parts.push(line.slice(m[0].length).trim());
        }
        else if (line.trim() && !line.startsWith('whisper_') && !line.startsWith('system_info:')) {
            // Plain text line not matching the timestamp prefix — include only
            // if it doesn't look like a log message.
            if (parts.length > 0 || /\w/.test(line))
                parts.push(line.trim());
        }
    }
    return parts.filter(Boolean).join(' ').trim();
}
// ──────────────────────────────────────────────────────────────────────────
// Stub provider — returns empty transcript. Useful in tests + when no
// engine is configured.
// ──────────────────────────────────────────────────────────────────────────
export class StubVoiceProvider {
    name = 'stub';
    async transcribe() {
        return { text: '', latencyMs: 0 };
    }
}
// ──────────────────────────────────────────────────────────────────────────
// Setup detection — is whisper.cpp + a model installed and configured?
// ──────────────────────────────────────────────────────────────────────────
export { detectVoice, expandHome, WHISPER_BIN_CANDIDATES, DEFAULT_MODEL_RELPATH, } from './detect.js';
// ──────────────────────────────────────────────────────────────────────────
// Microphone capture — record a WAV for whisper.cpp to transcribe.
// ──────────────────────────────────────────────────────────────────────────
export { detectRecorder, recordToWav, buildRecordArgs, RECORDER_CANDIDATES, } from './record.js';
//# sourceMappingURL=index.js.map