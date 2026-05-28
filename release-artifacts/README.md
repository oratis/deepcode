# DeepCode v0.1.0 — Release Artifacts

## What's in here

| File | Size | What |
| --- | --- | --- |
| `DeepCode-0.1.0-arm64-unsigned.dmg` | 4.7 MB | macOS Apple Silicon installer (Tauri-based). **Currently unsigned** — see Apple Signing below. |
| `deepcode-cli-0.1.0-bundle.tgz` | 4.4 MB | Self-contained CLI bundle (includes node_modules) |
| `install-cli.sh` | — | One-line installer for the CLI |

---

## Install the CLI

### Option 1 — One-liner from this folder

```bash
bash install-cli.sh
```

This extracts the bundle to `~/.local/share/deepcode/` and symlinks
`deepcode` into `~/.local/bin/` (or `/usr/local/bin/` if writeable).

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

## Install the Mac client

### What you get

A `.app` bundle (6.8 MB extracted) + `.dmg` installer (4.7 MB).
Architecture: **Apple Silicon** (`arm64`). Intel build is a separate
artifact — see "Universal build" below.

### Install

1. Double-click `DeepCode-0.1.0-arm64-unsigned.dmg`
2. Drag **DeepCode.app** into the **Applications** folder shortcut
3. Eject the DMG, open Applications → DeepCode

### Gatekeeper warning on first launch

The DMG is **currently unsigned** — Apple Developer ID signing pipeline
is in `scripts/sign-and-notarize.sh` but requires the maintainer's
Apple credentials to run.

When you first launch DeepCode.app, macOS will say "DeepCode cannot
be opened because Apple cannot check it for malicious software."

To open it:
- **Method A** (one-time): Right-click the .app → **Open** → confirm
  the "Open" button in the dialog.
- **Method B**: System Settings → Privacy & Security → scroll down →
  "DeepCode was blocked..." → **Open Anyway**.
- **Method C** (terminal): `xattr -d com.apple.quarantine /Applications/DeepCode.app`

After the first successful launch, macOS remembers your decision —
subsequent launches work normally.

---

## Apple Signing (for the maintainer)

To produce a signed + notarized DMG (no Gatekeeper warning):

1. Enroll in Apple Developer Program ($99/yr): https://developer.apple.com/programs/
2. Generate "Developer ID Application" cert + import into login keychain
3. Get `TEAM_ID` from https://developer.apple.com/account → Membership
4. Generate app-specific password at https://appleid.apple.com → "App-Specific Passwords"
5. Store credentials in keychain (one-time):
   ```bash
   xcrun notarytool store-credentials "DEEPCODE_NOTARY" \
     --apple-id "<you>@example.com" \
     --team-id "<TEAM_ID>" \
     --password "<app-specific-password>"
   ```
6. Run the sign + notarize script:
   ```bash
   bash scripts/sign-and-notarize.sh
   ```

End-to-end takes ~10-15 min (Apple's notarization servers usually return
in 2-5 minutes during off-peak hours).

The script writes the signed DMG back to:
`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/DeepCode_0.1.0_aarch64.dmg`

---

## Universal build (Intel + Apple Silicon)

```bash
. "$HOME/.cargo/env"
rustup target add x86_64-apple-darwin aarch64-apple-darwin
pnpm --filter @deepcode/desktop tauri build --target universal-apple-darwin
```

Output: `apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/`

Universal builds are ~2× the size of single-arch.

---

## Versions

- **DeepCode CLI**: 0.1.0
- **DeepCode Mac**: 0.1.0
- **Built**: 2026-05-28
- **Tauri runtime**: 2.x (native WebKit)
- **Node engine (CLI)**: ≥22

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
