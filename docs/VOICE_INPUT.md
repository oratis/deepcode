# Voice input (whisper.cpp local)

DeepCode supports voice input via a local whisper.cpp install — no cloud
ASR call, no audio leaving the machine.

## Install whisper.cpp

### macOS (Homebrew)

```bash
brew install whisper-cpp
```

This puts `whisper-cli` (or `whisper`, depending on brew version) on the
PATH. Confirm with:

```bash
which whisper-cli || which whisper
whisper-cli --help
```

### Linux

```bash
# Clone + build
git clone https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp
cd /tmp/whisper.cpp
make -j

# Install the binary somewhere on PATH
sudo cp main /usr/local/bin/whisper
```

### Manual macOS build

```bash
git clone https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp
cd /tmp/whisper.cpp
make -j
sudo cp main /usr/local/bin/whisper
```

## Download a model

whisper.cpp ships a download script:

```bash
cd "$(brew --prefix whisper-cpp)/share/whisper-cpp"  # or wherever the repo lives
bash ./models/download-ggml-model.sh base.en
# OR a larger model:
bash ./models/download-ggml-model.sh small.en
bash ./models/download-ggml-model.sh medium.en
```

Recommended for fast dictation: `base.en` (~140 MB).
For accurate multi-language: `small` (~470 MB) or `medium` (~1.4 GB).

The script saves the `.bin` file alongside the script — copy it
somewhere DeepCode can find it:

```bash
mkdir -p ~/.deepcode/models
cp models/ggml-base.en.bin ~/.deepcode/models/whisper-base.en.bin
```

## Install a mic recorder

DeepCode records your microphone with whichever recorder it finds on PATH —
`ffmpeg` is tried first, then sox's `rec` / `sox`:

```bash
# macOS
brew install ffmpeg   # or: brew install sox

# Linux (Debian/Ubuntu)
sudo apt install ffmpeg   # or: sudo apt install sox
```

## Configure DeepCode

In `~/.deepcode/settings.json`:

```json
{
  "voice": {
    "provider": "whisper.cpp",
    "binPath": "/opt/homebrew/bin/whisper-cli",
    "modelPath": "~/.deepcode/models/whisper-base.en.bin"
  }
}
```

(The `binPath` defaults to `whisper-cli` / `whisper` on PATH if you omit it.)
If ffmpeg captures from the wrong input, set `voice.inputDevice` — e.g.
`":1"` for avfoundation (macOS) or `"hw:1"` for ALSA (Linux). sox/rec always
use the system default device.

## Usage

In the CLI REPL, type `/voice` and press Enter. DeepCode:

1. Records audio from your default mic (via ffmpeg or sox) into a temp
   `.wav` file.
2. Stops when you press Enter again (or after a 60 s safety cap).
3. Spawns whisper.cpp to transcribe the `.wav` locally.
4. Pre-fills the input line with the transcript — edit it if needed, then
   press Enter to send.

Run `/voice setup` any time to print install steps and what's detected.

In the Mac desktop client, the same flow is a 🎙 button in the composer:
click to record, click again to stop and transcribe. The desktop path uses
ffmpeg specifically (it stops recording by sending `q` to ffmpeg's stdin) and
prompts for microphone access on first use.

## Privacy

- Audio file is written to `$TMPDIR/deepcode-voice-<random>.wav` and
  deleted immediately after transcription succeeds.
- Whisper.cpp runs entirely locally — no network call.
- The transcribed text follows the standard agent loop (sandbox /
  permissions / hooks still apply to anything it triggers).

## Troubleshooting

- **`Error: whisper.cpp exited 1: model not found`** — `modelPath` is
  wrong. Check the file exists with `ls -lh <path>`.
- **Empty transcript** — the audio file may be silent or too short.
  Try a longer phrase, or check the mic input level in System Settings.
- **Very slow** — try a smaller model (`base.en` over `small`). On Apple
  Silicon, whisper.cpp uses the GPU automatically; on Intel it's CPU-only.

## API (for plugin authors)

```ts
import { WhisperCppProvider } from '@deepcode/core';

const provider = new WhisperCppProvider({
  binPath: '/opt/homebrew/bin/whisper-cli',
  modelPath: '~/.deepcode/models/whisper-base.en.bin',
});

const result = await provider.transcribe('/tmp/my-clip.wav', {
  language: 'en', // optional; whisper auto-detects otherwise
});

console.log(result.text); // "hello world"
```
