#!/usr/bin/env bash
#
# Uninstall the DeepCode scheduled-tasks LaunchAgent.
# Unloads from launchd, then removes the plist file. Idempotent.

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: uninstall-cron-daemon.sh is macOS-only."
  exit 1
fi

PLIST_LABEL="dev.deepcode.scheduler"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "==> Nothing to do — no plist at $PLIST_PATH"
  # Defensive: also try to unload by label in case the file was removed
  # by hand but launchd still has a handle.
  launchctl remove "$PLIST_LABEL" 2>/dev/null || true
  exit 0
fi

echo "==> launchctl unload -w $PLIST_PATH ..."
launchctl unload -w "$PLIST_PATH" 2>/dev/null || true

echo "==> Removing $PLIST_PATH ..."
rm -f "$PLIST_PATH"

echo ""
echo "==> DONE. DeepCode scheduler is uninstalled."
echo "    (Logs under ~/.deepcode/scheduler.{log,err.log} were kept.)"
