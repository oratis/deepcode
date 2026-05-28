# DeepCode v0.1.0 — Release Artifacts

## What's in here

| File | Size | What |
| --- | --- | --- |
| **`DeepCode-0.1.0-arm64.dmg`** | **4.7 MB** | macOS Apple Silicon installer (Tauri-based) · **Signed + Apple-notarized** ✓ |
| `deepcode-cli-0.1.0-bundle.tgz` | 4.4 MB | Self-contained CLI bundle (includes node_modules) |
| `install-cli.sh` | 1.3 KB | One-line installer for the CLI |
| `SIGNING_LOG.md` | — | Record of how the DMG was signed + notarized |

---

## Install the Mac client (signed + notarized)

```bash
open release-artifacts/DeepCode-0.1.0-arm64.dmg
```

- Drag **DeepCode.app** → **Applications** folder
- Eject the DMG, open Applications → DeepCode
- **No Gatekeeper warning** — the .app is signed by Bihao Wang (Team `9LH9NBX7P4`) and notarized by Apple

To verify yourself:

```bash
codesign --verify --deep --strict /Applications/DeepCode.app
spctl --assess --type exec --verbose /Applications/DeepCode.app
# Expected: accepted, source=Notarized Developer ID
xcrun stapler validate /Applications/DeepCode.app
# Expected: The validate action worked!
```

---

## Install the CLI

### Option 1 — One-liner from this folder

```bash
bash install-cli.sh
```

This extracts the bundle to `~/.local/share/deepcode/` and symlinks
`deepcode` into `~/.local/bin/` (or `/usr/local/bin/` if writable).

### Option 2 — Manual

```bash
mkdir -p ~/.local/share/deepcode
tar xzf deepcode-cli-0.1.0-bundle.tgz -C ~/.local/share/deepcode
ln -sf ~/.local/share/deepcode/deepcode-cli-deploy/dist/cli.js ~/.local/bin/deepcode
chmod +x ~/.local/bin/deepcode
```

Make sure `~/.local/bin` is on your PATH. Add to `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### First run

```bash
deepcode              # interactive — prompts for DeepSeek API key
deepcode --help       # full flag reference
deepcode -p "hi"      # one-shot
```

Requirements: **Node.js 22+** on PATH.

---

## Architecture

- **Mac client**: Tauri 2 (Rust main process + native WebKit webview)
  - Bundle: 4.7 MB DMG · 6.8 MB .app · ~80 MB RSS idle
  - vs Electron alternative: would have been ~150 MB / ~250 MB RSS
- **CLI**: Node.js 22+ via `@deepcode/core` ESM modules
- **Agent loop**: `@deepcode/core` — same code drives CLI + desktop +
  VS Code extension + LSP bridge

---

## Universal build (Intel + Apple Silicon)

The shipped DMG is `aarch64` (Apple Silicon) only. For a universal binary:

```bash
. "$HOME/.cargo/env"
rustup target add x86_64-apple-darwin aarch64-apple-darwin
pnpm --filter @deepcode/desktop tauri build --target universal-apple-darwin
# Then rerun scripts/sign-and-notarize.sh with DEEPCODE_TARGET=universal-apple-darwin
```

Universal builds are ~2× the size.

---

## Versions

- **DeepCode CLI**: 0.1.0
- **DeepCode Mac**: 0.1.0
- **Built**: 2026-05-28
- **Tauri runtime**: 2.11.2 (native WebKit)
- **Node engine (CLI)**: ≥22
- **Signing**: Developer ID Application: Bihao Wang (`9LH9NBX7P4`)
- **Apple notarization**: ticket stapled to both `.app` and `.dmg`

---

## Uninstall

```bash
# CLI
rm -f ~/.local/bin/deepcode /usr/local/bin/deepcode
rm -rf ~/.local/share/deepcode

# Mac app
rm -rf /Applications/DeepCode.app

# Config (optional — keeps your sessions + API key by default)
rm -rf ~/.deepcode
```
