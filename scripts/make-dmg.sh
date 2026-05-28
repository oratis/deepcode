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

# ---- Detach any stale mounts with the same volume name ----
while mount | grep -qE "/Volumes/$VOLNAME([[:space:]]|$)"; do
  STALE_DEV=$(mount | grep -E "/Volumes/$VOLNAME([[:space:]]|$)" | awk '{print $1}' | head -1)
  echo "==> Detaching stale mount $STALE_DEV ..."
  hdiutil detach "$STALE_DEV" -force >/dev/null 2>&1 || true
  sleep 1
done
# Also detach numbered variants ("DeepCode 1", "DeepCode 2"...)
for v in /Volumes/$VOLNAME*; do
  [ -d "$v" ] || continue
  hdiutil detach "$v" -force >/dev/null 2>&1 || true
done

# ---- Stage the source files ----
STAGING="$(mktemp -d)/staging"
mkdir -p "$STAGING"
cp -R "$APP_PATH" "$STAGING/$(basename "$APP_PATH")"
ln -s /Applications "$STAGING/Applications"

# ---- 1) Create a read-write DMG (oversized so Finder has room to write .DS_Store) ----
RW_DMG="$(mktemp -d)/rw.dmg"
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
MOUNT_OUTPUT="$(hdiutil attach -readwrite -noverify -noautoopen "$RW_DMG")"
MOUNT_DEV="$(echo "$MOUNT_OUTPUT" | grep -E '^/dev/' | tail -1 | awk '{print $1}')"
MOUNT_POINT="/Volumes/$VOLNAME"

# Sanity: confirm the expected mount point exists
if [ ! -d "$MOUNT_POINT" ]; then
  echo "ERROR: mount point $MOUNT_POINT not found"
  echo "$MOUNT_OUTPUT"
  hdiutil detach "$MOUNT_DEV" -force >/dev/null 2>&1 || true
  exit 1
fi
echo "    mounted at: $MOUNT_POINT  (dev=$MOUNT_DEV)"

# ---- 3) AppleScript: set view + icon size + positions ----
echo "==> Applying Finder customization (AppleScript) ..."
APP_NAME="$(basename "$APP_PATH")"
/usr/bin/osascript <<EOF
tell application "Finder"
  tell disk "$VOLNAME"
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
hdiutil detach "$MOUNT_DEV" -force >/dev/null
sleep 1

# ---- 6) Convert to compressed read-only UDZO ----
echo "==> Converting to compressed read-only UDZO ..."
rm -f "$DMG_PATH"
mkdir -p "$(dirname "$DMG_PATH")"
hdiutil convert "$RW_DMG" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -o "$DMG_PATH" >/dev/null

# Cleanup
rm -rf "$STAGING" "$RW_DMG"

echo "✓ Created $DMG_PATH ($(du -h "$DMG_PATH" | cut -f1))"
