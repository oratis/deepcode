// Voice setup detection — resolves the whisper.cpp binary + model so the
// `/voice` command (and, later, the desktop client) can report readiness and
// print actionable setup steps. Pure logic over injectable probes so it is
// unit-testable without touching the real PATH / filesystem.
// Spec: docs/VOICE_INPUT.md
import { access, stat } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
/** Binary names searched on PATH when `voice.binPath` is unset, in order. */
export const WHISPER_BIN_CANDIDATES = ['whisper-cli', 'whisper'];
/** Default model location probed when `voice.modelPath` is unset (under home). */
export const DEFAULT_MODEL_RELPATH = ['.deepcode', 'models', 'whisper-base.en.bin'];
/** Expand a leading `~` / `~/` to the home dir. Other paths pass through. */
export function expandHome(p, home) {
    if (p === '~')
        return home;
    if (p.startsWith('~/'))
        return join(home, p.slice(2));
    return p;
}
/** Real PATH lookup — first dir in $PATH holding an executable `name`. */
async function whichOnPath(name) {
    const dirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
    for (const dir of dirs) {
        const candidate = join(dir, name);
        try {
            await access(candidate, FS.X_OK);
            return candidate;
        }
        catch {
            /* not here, or not executable */
        }
    }
    return null;
}
/** Real existence check — true only for a regular file. */
async function isFile(path) {
    try {
        return (await stat(path)).isFile();
    }
    catch {
        return false;
    }
}
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
export async function detectVoice(voice, probe) {
    const home = probe?.home ?? homedir();
    const which = probe?.which ?? whichOnPath;
    const fileExists = probe?.fileExists ?? isFile;
    const provider = voice?.provider ?? 'whisper.cpp';
    const problems = [];
    if (provider !== 'whisper.cpp' && provider !== 'stub') {
        problems.push(`Unknown voice provider "${provider}" — expected "whisper.cpp".`);
    }
    // Resolve the binary.
    let binPath;
    if (voice?.binPath) {
        const p = expandHome(voice.binPath, home);
        if (await fileExists(p))
            binPath = p;
        else
            problems.push(`Configured voice.binPath not found: ${voice.binPath}`);
    }
    else {
        for (const name of WHISPER_BIN_CANDIDATES) {
            const found = await which(name);
            if (found) {
                binPath = found;
                break;
            }
        }
        if (!binPath) {
            problems.push(`whisper.cpp binary not found on PATH (looked for ${WHISPER_BIN_CANDIDATES.join(', ')}).`);
        }
    }
    // Resolve the model.
    let modelPath;
    if (voice?.modelPath) {
        const p = expandHome(voice.modelPath, home);
        if (await fileExists(p))
            modelPath = p;
        else
            problems.push(`Configured voice.modelPath not found: ${voice.modelPath}`);
    }
    else {
        const def = join(home, ...DEFAULT_MODEL_RELPATH);
        if (await fileExists(def))
            modelPath = def;
        else
            problems.push(`No voice.modelPath set, and no model at the default ~/${DEFAULT_MODEL_RELPATH.join('/')}.`);
    }
    const ready = problems.length === 0 && !!binPath && !!modelPath;
    return { ready, provider, binPath, modelPath, problems };
}
//# sourceMappingURL=detect.js.map