# Shipping the Mac client (M6 → v1)

End-to-end checklist for going from the current `apps/desktop` skeleton
to a notarized `.dmg` published on GitHub Releases.

This document is for the human maintainer; the agent can't do steps that
require an Apple Developer ID or a real device.

## Prerequisites

1. **Apple Developer Program membership** ($99/year).
2. **Xcode** installed (provides codesign + altool).
3. A **Developer ID Application** certificate downloaded into the
   login keychain. Generate via Xcode → Settings → Accounts → Manage
   Certificates → "+" → Developer ID Application.
4. An **app-specific password** for the Apple ID:
   https://appleid.apple.com → Sign-In and Security → App-Specific
   Passwords. (Used by notarytool — do NOT use your main Apple ID
   password.)
5. **GitHub Personal Access Token** with `repo` scope, for
   `electron-builder` to publish releases.

## One-time CI secrets

In the repo's GitHub Actions secrets, add:

| Name                          | Value                                          |
| ----------------------------- | ---------------------------------------------- |
| `APPLE_ID`                    | Your Apple Developer login email               |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from step 4          |
| `APPLE_TEAM_ID`               | 10-char team ID (Membership tab in dev portal) |
| `CSC_LINK`                    | Base64-encoded `.p12` of the Developer ID cert |
| `CSC_KEY_PASSWORD`            | Password used when exporting the `.p12`        |
| `GH_TOKEN`                    | The PAT from step 5                            |

To export the `.p12`:

```bash
# In Keychain Access: select your Developer ID Application cert + private
# key → Export → set a password → save as cert.p12, then:
base64 -i cert.p12 -o cert.p12.b64
# Paste contents of cert.p12.b64 into the CSC_LINK secret.
```

## First local build

```bash
# 1. Install the heavy deps (~250 MB)
pnpm add -D --filter @deepcode/desktop \
  electron electron-builder electron-updater \
  vite @vitejs/plugin-react \
  tailwindcss postcss autoprefixer \
  concurrently wait-on

# 2. Activate the .template configs
mv apps/desktop/vite.config.template.ts apps/desktop/vite.config.ts
mv apps/desktop/postcss.config.template.js apps/desktop/postcss.config.js

# 3. Dev mode (vite HMR + electron auto-reload)
pnpm --filter @deepcode/desktop dev

# 4. Package an unsigned .app for local testing
pnpm --filter @deepcode/desktop pack

# 5. Full signed + notarized .dmg
APPLE_ID=...@... \
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx \
APPLE_TEAM_ID=ABCDEF1234 \
CSC_LINK=$(base64 -i ~/Downloads/cert.p12) \
CSC_KEY_PASSWORD=mypassword \
pnpm --filter @deepcode/desktop dist
```

The signed `.dmg` lands in `apps/desktop/release/`.

## Releasing via tag

```bash
# Make sure main is green, then:
git tag v1.0.0
git push origin v1.0.0
```

The `.github/workflows/release.yml` workflow:

1. Runs the test/build matrix.
2. Publishes `deepcode-cli` to npm.
3. Builds + signs + notarizes the Mac `.dmg`.
4. Creates a GitHub Release tagged with `v1.0.0` and attaches the `.dmg`.
5. `electron-updater` in installed clients picks up the new release via
   the GitHub releases feed (see main.ts `setupAutoUpdater`).

## Sanity-checking notarization

After the upload, run:

```bash
xcrun notarytool history --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID"

# Or check a single submission:
xcrun notarytool info <submission-id> --apple-id "$APPLE_ID" ...
```

Once Apple says "Accepted", verify locally:

```bash
spctl -a -t exec -vv /Applications/DeepCode.app
# Should print: accepted, source=Notarized Developer ID
```

## Auto-update flow

1. User opens an old DeepCode build (v1.0.0).
2. `electron-updater.checkForUpdatesAndNotify()` polls the GitHub Releases
   feed once per launch.
3. If a newer release exists, downloads it in the background.
4. On download complete, fires `updater:update-downloaded` IPC event →
   the renderer's `UpdateBanner` shows "DeepCode vX.Y.Z is ready to
   install. Relaunch to update."
5. User clicks "Relaunch now" → main process calls `app.relaunch()` +
   `app.quit()`. (Wiring TBD — currently `window.location.reload()` stub.)

## Common failures

- **"Invalid Developer ID Certificate"** — usually the `.p12` doesn't
  include the private key. Re-export with both checked.
- **Notarization stuck "In Progress"** — Apple's servers can take 30 min
  during peak hours. Wait or open the dev portal to inspect.
- **`spctl` rejects** — make sure `dmg.notarize: true` is set in
  `electron-builder.yml`. (It is, but worth re-checking.)
- **App opens then immediately crashes** — first run after notarization
  needs `xattr -d com.apple.quarantine /Applications/DeepCode.app` if you
  copied the .app outside the .dmg.

## What's still hardcoded that should be parametrized later

- `appId: dev.deepcode.client` — fine for v1, may want a more specific
  team-prefixed ID for marketplace listings.
- `category: developer-tools` — fine.
- Icon: needs a real `.icns` at `build-resources/icon.icns` (currently
  missing — provide one before first build).
