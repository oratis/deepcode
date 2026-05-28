#!/usr/bin/env bash
#
# Sign + notarize the DeepCode Mac .app + .dmg.
# Modeled on Markup's flow.
#
# Run once interactively to store credentials (this needs the user's Apple ID + team ID + app-specific password):
#
#   xcrun notarytool store-credentials "DEEPCODE_NOTARY" \
#     --apple-id "<you>@example.com" \
#     --team-id "<TEAM_ID>" \
#     --password "<app-specific-password>"
#
# Then this script runs unattended.
#
# Env vars:
#   DEEPCODE_SIGNING_ID   (optional)  override auto-detected Developer ID Application identity
#   DEEPCODE_TARGET       (optional)  default 'aarch64-apple-darwin'; set 'universal-apple-darwin' for fat binary
#   DEEPCODE_NOTARY_PROFILE (optional) keychain profile name; default 'DEEPCODE_NOTARY'

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Make sure cargo is on PATH
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.cargo/env"
fi

TARGET="${DEEPCODE_TARGET:-aarch64-apple-darwin}"
PROFILE="${DEEPCODE_NOTARY_PROFILE:-DEEPCODE_NOTARY}"

# ----- 1. Build release artifact -----
echo "==> Building release for $TARGET ..."
pnpm --filter @deepcode/desktop tauri build --target "$TARGET"

# Locate artifacts
APP_PATH="apps/desktop/src-tauri/target/$TARGET/release/bundle/macos/DeepCode.app"
DMG_DIR="apps/desktop/src-tauri/target/$TARGET/release/bundle/dmg"
DMG_PATH="$(ls -t "$DMG_DIR"/*.dmg 2>/dev/null | head -1 || true)"

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: $APP_PATH not found — build failed?"
  exit 1
fi

# ----- 2. Find signing identity -----
SIGNING_ID="${DEEPCODE_SIGNING_ID:-}"
if [ -z "$SIGNING_ID" ]; then
  SIGNING_ID="$(security find-identity -v -p codesigning | grep 'Developer ID Application' | head -1 | sed -E 's/.*\) ([A-F0-9]+) "(.+)"/\2/' || true)"
fi
if [ -z "$SIGNING_ID" ]; then
  echo "ERROR: no Developer ID Application certificate in keychain."
  echo "Download from https://developer.apple.com/account/resources/certificates"
  echo "or set DEEPCODE_SIGNING_ID env var."
  exit 1
fi
echo "==> Signing identity: $SIGNING_ID"

# ----- 3. Re-sign the .app with hardened runtime -----
echo "==> Signing $APP_PATH ..."
codesign --force --deep --options runtime \
  --entitlements apps/desktop/src-tauri/Entitlements.plist \
  --sign "$SIGNING_ID" \
  --timestamp \
  "$APP_PATH"

# ----- 4. Verify signature -----
echo "==> Verifying signature ..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type execute --verbose "$APP_PATH" || true

# ----- 5. Notarize the .app via zip -----
ZIP_PATH="$(mktemp -d)/DeepCode.zip"
echo "==> Submitting $APP_PATH to notarytool ..."
/usr/bin/ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"
xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$PROFILE" --wait

# ----- 6. Staple notarization to the .app -----
echo "==> Stapling notarization ticket to $APP_PATH ..."
xcrun stapler staple "$APP_PATH"

# ----- 7. Rebuild the .dmg with the NOW-signed-and-stapled .app -----
# IMPORTANT: Tauri's bundle_dmg.sh ran in step 1 and baked the UNSIGNED .app
# into the DMG. Just signing the DMG container doesn't fix that — Apple
# notarization unpacks the DMG and re-verifies the .app inside. So we
# rebuild the DMG from scratch with the now-signed .app, plus apply the
# pretty Finder layout (700x420 window, 128px icons, centered positions).
if [ -n "$DMG_PATH" ] && [ -f "$DMG_PATH" ]; then
  echo "==> Rebuilding DMG with signed+stapled .app + Finder layout ..."
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  bash "$SCRIPT_DIR/make-dmg.sh" "$APP_PATH" "$DMG_PATH" "DeepCode"

  echo "==> Signing $DMG_PATH ..."
  codesign --force --sign "$SIGNING_ID" --timestamp "$DMG_PATH"

  echo "==> Notarizing $DMG_PATH ..."
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$PROFILE" --wait

  echo "==> Stapling notarization ticket to $DMG_PATH ..."
  xcrun stapler staple "$DMG_PATH"

  echo "==> Verifying DMG ..."
  spctl --assess --type open --context context:primary-signature --verbose "$DMG_PATH" || true
else
  echo "WARN: no DMG produced — only the .app was notarized."
fi

echo ""
echo "==> DONE."
[ -n "$DMG_PATH" ] && echo "DMG:  $DMG_PATH"
echo ".app: $APP_PATH"
