// Interactive voice capture for the REPL: detect whisper.cpp + a recorder,
// record from the mic until the user presses Enter, transcribe locally, and
// return the text so the REPL can pre-fill the input line. The audio file is
// written to $TMPDIR and deleted right after transcription (see VOICE_INPUT.md).
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectRecorder, detectVoice, recordToWav, WhisperCppProvider, } from '@deepcode/core';
import { voiceSetupLines } from './commands.js';
export async function captureVoice(deps) {
    const { rl, output, settings, home } = deps;
    const status = await detectVoice(settings.voice, { home });
    if (!status.ready)
        return { transcript: null, lines: voiceSetupLines(status) };
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
    const cleanup = async () => {
        await rm(wav, { force: true });
        await rm(`${wav}.txt`, { force: true }); // whisper --output-txt side-file
    };
    // Record until the user presses Enter (abort → SIGINT → recorder flushes WAV).
    const ac = new AbortController();
    let recErr;
    const recording = recordToWav({
        outPath: wav,
        bin: rec.bin,
        binPath: rec.binPath,
        signal: ac.signal,
        device: settings.voice?.inputDevice,
    }).catch((e) => {
        recErr = e;
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
            modelPath: status.modelPath,
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
    }
    catch (e) {
        await cleanup();
        return { transcript: null, lines: [`  ⚠ Transcription failed: ${e.message}`] };
    }
}
//# sourceMappingURL=voice-capture.js.map