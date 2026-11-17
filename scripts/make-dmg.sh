#!/usr/bin/env bash
#
# Build a pretty DMG with the SIGNED .app embedded.
# Used by sign-and-notarize.sh after the .app has been signed + stapled.
#
# Customizes via AppleScript: window size, icon size (128 px), centered positions.
# Tauri's default bundle_dmg.sh can't set iconSize, hence this.

set -euo pipefail

APP_PATH="${1:-}"
DMG_PATH="${2:-}"
VOLNAME="${3:-DeepCode}"

if [ -z "$APP_PATH" ] || [ -z "$DMG_PATH" ]; then
  echo "Usage: make-dmg.sh <path/to/App.app> <output.dmg> [VolumeName]"
  exit 2
fi

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: $APP_PATH does not exist"
  exit 1
fi

# Only mount and detach the image created by this invocation. An existing
# DeepCode volume may belong to a user installing another release.
TEMP_DIR="$(mktemp -d)"
STAGING="$TEMP_DIR/staging"
RW_DMG="$TEMP_DIR/rw.dmg"
MOUNT_POINT="$TEMP_DIR/mount"
MOUNTED=0
cleanup() {
  if [ "$MOUNTED" = 1 ]; then
    hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || return
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT
mkdir -p "$STAGING" "$MOUNT_POINT"
ditto "$APP_PATH" "$STAGING/$(basename "$APP_PATH")"
ln -s /Applications "$STAGING/Applications"

# ---- 1) Create a read-write DMG (oversized so Finder has room to write .DS_Store) ----
APP_SIZE_KB=$(du -sk "$APP_PATH" | awk '{print $1}')
DMG_SIZE_KB=$((APP_SIZE_KB + 20000))  # +20MB headroom for .DS_Store, fseventsd, customization
echo "==> Creating read-write DMG (~${DMG_SIZE_KB} KB) ..."
hdiutil create \
  -volname "$VOLNAME" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDRW \
  -fs HFS+ \
  -size "${DMG_SIZE_KB}k" \
  "$RW_DMG" >/dev/null

# ---- 2) Mount it ----
echo "==> Mounting for customization ..."
hdiutil attach -readwrite -noverify -noautoopen -mountpoint "$MOUNT_POINT" "$RW_DMG" >/dev/null
MOUNTED=1

# ---- 3) AppleScript: set view + icon size + positions ----
echo "==> Applying Finder customization (AppleScript) ..."
APP_NAME="$(basename "$APP_PATH")"
/usr/bin/osascript <<EOF
tell application "Finder"
  tell folder (POSIX file "$MOUNT_POINT" as alias)
    open
    delay 1
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    -- window 700 × 420 (slightly bigger than Tauri default 660 × 400)
    -- Top-left at {400, 100} → bottom-right at {1100, 520}
    set the bounds of container window to {400, 100, 1100, 520}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 128
    set text size of viewOptions to 13
    -- Center the two icons vertically (window inner height ~392, icon ~150 with label → y=200 puts label baseline near center)
    -- Horizontally: 700 wide, two icons centered with arrow between
    set position of item "$APP_NAME" of container window to {200, 200}
    set position of item "Applications" of container window to {500, 200}
    update without registering applications
    delay 3
    close
  end tell
end tell
EOF

# ---- 4) Give Finder time to flush .DS_Store, then verify ----
echo "==> Waiting for Finder to flush .DS_Store ..."
sleep 5
sync
sleep 2

# Sanity check: .DS_Store must exist on the volume now
if [ ! -f "$MOUNT_POINT/.DS_Store" ]; then
  echo "WARNING: .DS_Store not yet written; waiting another 5s ..."
  sleep 5
  sync
fi
if [ -f "$MOUNT_POINT/.DS_Store" ]; then
  echo "    ✓ .DS_Store written ($(stat -f%z "$MOUNT_POINT/.DS_Store") bytes)"
else
  echo "    ✗ .DS_Store STILL not written — layout will revert on open"
fi

# Set permissions so user can't accidentally modify on first open
chmod -Rf go-w "$MOUNT_POINT" 2>/dev/null || true

# ---- 5) Detach ----
echo "==> Detaching ..."
hdiutil detach "$MOUNT_POINT" >/dev/null
MOUNTED=0
sleep 1

# ---- 6) Convert to compressed read-only UDZO ----
echo "==> Converting to compressed read-only UDZO ..."
mkdir -p "$(dirname "$DMG_PATH")"
hdiutil convert "$RW_DMG" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov -o "$DMG_PATH" >/dev/null


echo "✓ Created $DMG_PATH ($(du -h "$DMG_PATH" | cut -f1))"
