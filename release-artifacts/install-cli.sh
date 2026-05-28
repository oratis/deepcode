#!/usr/bin/env bash
# DeepCode CLI installer (local bundle).
# Usage:
#   bash install-cli.sh
# Installs `deepcode` into ~/.local/bin (or /usr/local/bin if writeable).

set -euo pipefail

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deepcode-cli-0.1.0-bundle.tgz"
INSTALL_PARENT="$HOME/.local/share/deepcode"

if [ ! -f "$BUNDLE" ]; then
  echo "ERROR: bundle not found at $BUNDLE"
  exit 1
fi

# Pick a bin dir on PATH
if [ -w "/usr/local/bin" ]; then
  BIN_DIR="/usr/local/bin"
else
  BIN_DIR="$HOME/.local/bin"
fi
mkdir -p "$BIN_DIR" "$INSTALL_PARENT"

# Wipe old install
rm -rf "$INSTALL_PARENT/deepcode-cli-deploy"

# Extract
tar xzf "$BUNDLE" -C "$INSTALL_PARENT"

# Symlink the entry into PATH
TARGET="$INSTALL_PARENT/deepcode-cli-deploy/dist/cli.js"
chmod +x "$TARGET" 2>/dev/null || true
ln -sf "$TARGET" "$BIN_DIR/deepcode"

# Sanity check
if ! command -v node >/dev/null; then
  echo "WARN: Node.js not found on PATH. DeepCode CLI requires Node 22+."
  echo "Install from https://nodejs.org/ then re-run."
fi

echo ""
echo "✓ DeepCode CLI installed."
echo "  Binary: $BIN_DIR/deepcode  →  $TARGET"
if ! echo ":$PATH:" | grep -q ":$BIN_DIR:"; then
  echo ""
  echo "  ⚠  $BIN_DIR is not on your PATH. Add this to ~/.zshrc:"
  echo "      export PATH=\"$BIN_DIR:\$PATH\""
fi
echo ""
echo "Run: deepcode"
