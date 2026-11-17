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
#   DEEPCODE_SKIP_BUILD (optional) 1 to sign an already built candidate

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
if [ "${DEEPCODE_SKIP_BUILD:-0}" != 1 ]; then
  echo "==> Building release for $TARGET ..."
  pnpm --filter @deepcode/desktop tauri build --target "$TARGET"
fi

# Locate artifacts
APP_PATH="apps/desktop/src-tauri/target/$TARGET/release/bundle/macos/DeepCode.app"
DMG_DIR="apps/desktop/src-tauri/target/$TARGET/release/bundle/dmg"
# Tauri's bundle target is just "app"; we build the DMG ourselves in step 7
# via make-dmg.sh (gives us iconSize control + centered layout). Compute
# the expected output path here so step 7 can write to it.
mkdir -p "$DMG_DIR"
DMG_VER="$(grep '"version"' apps/desktop/src-tauri/tauri.conf.json | head -1 | sed -E 's/.*"version": "([^"]+)".*/\1/')"
case "$TARGET" in
  aarch64-apple-darwin) DMG_ARCH=aarch64 ;;
  x86_64-apple-darwin) DMG_ARCH=x64 ;;
  universal-apple-darwin) DMG_ARCH=universal ;;
  *) echo "Unsupported macOS target: $TARGET"; exit 1 ;;
esac
DMG_PATH="$DMG_DIR/DeepCode_${DMG_VER}_${DMG_ARCH}.dmg"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: $APP_PATH not found — build failed?"
  exit 1
fi
APP_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Contents/Info.plist")"
if [ "$APP_VER" != "$DMG_VER" ]; then
  echo "ERROR: app version $APP_VER does not match release version $DMG_VER; rebuild before signing."
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
SIDECAR_PATH="$APP_PATH/Contents/MacOS/deepcode-runtime"
if [ ! -x "$SIDECAR_PATH" ]; then
  echo "ERROR: bundled runtime not found at $SIDECAR_PATH"
  exit 1
fi
codesign --force --options runtime \
  --entitlements apps/desktop/src-tauri/RuntimeEntitlements.plist \
  --sign "$SIGNING_ID" \
  --timestamp \
  "$SIDECAR_PATH"
codesign --force --options runtime \
  --entitlements apps/desktop/src-tauri/Entitlements.plist \
  --sign "$SIGNING_ID" \
  --timestamp \
  "$APP_PATH"

# ----- 4. Verify signature -----
echo "==> Verifying signature ..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
node scripts/verify-mac-runtime.mjs "$APP_PATH"

# ----- 5. Notarize the .app via zip -----
ZIP_PATH="$TEMP_DIR/DeepCode.zip"
echo "==> Submitting $APP_PATH to notarytool ..."
/usr/bin/ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"
xcrun notarytool submit "$ZIP_PATH" --keychain-profile "$PROFILE" --wait

# ----- 6. Staple notarization to the .app -----
echo "==> Stapling notarization ticket to $APP_PATH ..."
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type execute --verbose "$APP_PATH"

# Tauri's build-time archive precedes our final Developer ID signature and
# notarization ticket. Always replace it with the final app before signing it.
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  UPDATE_PATH="$APP_PATH.tar.gz"
  # AppleDouble ._ entries break Tauri's extraction (it strips the app root
  # from every entry). The notarization ticket is Contents/CodeResources,
  # which is a regular file and remains in this archive.
  COPYFILE_DISABLE=1 tar -czf "$UPDATE_PATH" -C "$(dirname "$APP_PATH")" "$(basename "$APP_PATH")"
  pnpm --filter @deepcode/desktop exec tauri signer sign "$ROOT/$UPDATE_PATH"
  test -s "$UPDATE_PATH.sig"
fi

# ----- 7. Build the .dmg fresh with the signed+stapled .app -----
# Tauri's bundle targets are configured to skip "dmg" (bundle_dmg.sh has
# been flaky). We always build the DMG ourselves via make-dmg.sh — that
# gives us iconSize control + centered Finder layout + writes to a
# predictable path.
if [ -n "$DMG_PATH" ]; then
  echo "==> Building DMG with signed+stapled .app + pretty Finder layout ..."
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  bash "$SCRIPT_DIR/make-dmg.sh" "$APP_PATH" "$DMG_PATH" "DeepCode"

  echo "==> Signing $DMG_PATH ..."
  codesign --force --sign "$SIGNING_ID" --timestamp "$DMG_PATH"

  echo "==> Notarizing $DMG_PATH ..."
  xcrun notarytool submit "$DMG_PATH" --keychain-profile "$PROFILE" --wait

  echo "==> Stapling notarization ticket to $DMG_PATH ..."
  xcrun stapler staple "$DMG_PATH"

  echo "==> Verifying DMG ..."
  xcrun stapler validate "$DMG_PATH"
  codesign --verify --strict --verbose=2 "$DMG_PATH"
  spctl --assess --type open --context context:primary-signature --verbose "$DMG_PATH"
else
  echo "WARN: no DMG produced — only the .app was notarized."
fi

echo ""
echo "==> DONE."
[ -n "$DMG_PATH" ] && echo "DMG:  $DMG_PATH"
echo ".app: $APP_PATH"
