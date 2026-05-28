#!/usr/bin/env bash
#
# Install the DeepCode scheduled-tasks LaunchAgent.
#
# Writes ~/Library/LaunchAgents/dev.deepcode.scheduler.plist and then
# `launchctl load -w`s it so launchd starts firing every $DEEPCODE_INTERVAL
# seconds (default 60).
#
# Usage:
#   scripts/install-cron-daemon.sh                       # auto-detects binary
#   DEEPCODE_BIN=/usr/local/bin/deepcode scripts/install-cron-daemon.sh
#   DEEPCODE_INTERVAL=120 scripts/install-cron-daemon.sh # fire every 2 min
#
# Re-running is safe (idempotent — unloads any existing copy first).
#
# The plist XML below MUST match the format produced by
# packages/core/src/launchd/index.ts#buildPlist. There's a unit test that
# pins the format — update both in lockstep.

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: install-cron-daemon.sh is macOS-only (uses launchctl)."
  echo "For Linux, write a systemd timer — see docs/DEVELOPMENT_PLAN.md §3.15.4."
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Locate the deepcode binary. Allow override; otherwise prefer $(which deepcode),
# falling back to the locally-built CLI dist.
BIN="${DEEPCODE_BIN:-}"
if [[ -z "$BIN" ]]; then
  if command -v deepcode >/dev/null 2>&1; then
    BIN="$(command -v deepcode)"
  elif [[ -x "$ROOT/apps/cli/dist/index.js" ]]; then
    BIN="$ROOT/apps/cli/dist/index.js"
  else
    echo "ERROR: could not find a deepcode binary."
    echo "Run 'pnpm --filter deepcode-cli build' or set DEEPCODE_BIN=/path/to/deepcode."
    exit 1
  fi
fi

INTERVAL="${DEEPCODE_INTERVAL:-60}"
PLIST_LABEL="dev.deepcode.scheduler"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
LOG_DIR="$HOME/.deepcode"

mkdir -p "$LOG_DIR" "$(dirname "$PLIST_PATH")"

# Idempotency: unload any prior copy before re-writing.
if [[ -f "$PLIST_PATH" ]]; then
  echo "==> Existing plist found — unloading first ..."
  launchctl unload -w "$PLIST_PATH" 2>/dev/null || true
fi

echo "==> Writing $PLIST_PATH ..."

# Split the subcommand into separate <string> elements (default: "scheduler run")
SUBCMD="${DEEPCODE_SUBCMD:-scheduler run}"
ARGS_XML=""
ARGS_XML+="      <string>${BIN}</string>"$'\n'
for word in $SUBCMD; do
  ARGS_XML+="      <string>${word}</string>"$'\n'
done

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${ARGS_XML}  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/scheduler.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/scheduler.err.log</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
EOF

echo "==> launchctl load -w $PLIST_PATH ..."
launchctl load -w "$PLIST_PATH"

echo ""
echo "==> DONE. DeepCode scheduler is now active."
echo "    binary:   $BIN"
echo "    interval: ${INTERVAL}s"
echo "    logs:     $LOG_DIR/scheduler.log"
echo "    errors:   $LOG_DIR/scheduler.err.log"
echo "    status:   launchctl list | grep $PLIST_LABEL"
echo "    stop:     scripts/uninstall-cron-daemon.sh"
