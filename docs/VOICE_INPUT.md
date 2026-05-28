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

(The `binPath` defaults to `whisper` on PATH if you omit it.)

## Usage

In the CLI REPL, press the voice toggle key (default `Ctrl+V`; remap in
`~/.deepcode/keybindings.json`). DeepCode:

1. Records audio from your default mic into a temp `.wav` file.
2. Stops recording on the next key press OR after 60 s of silence.
3. Spawns whisper.cpp to transcribe the .wav.
4. Inserts the transcribed text into the input box (you can edit before
   submitting).

In the Mac client (M6-rest), the same flow appears as a 🎙 button.

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
