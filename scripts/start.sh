#!/bin/sh
set -eu
PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if command -v node >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
elif [ -x "$HOME/.volta/bin/node" ]; then
  NODE_BIN="$HOME/.volta/bin/node"
elif [ -x /opt/homebrew/bin/node ]; then
  NODE_BIN=/opt/homebrew/bin/node
elif [ -x /usr/local/bin/node ]; then
  NODE_BIN=/usr/local/bin/node
else
  echo 'Model Switcher requires Node.js 22 or later.' >&2
  exit 1
fi
exec "$NODE_BIN" "$PLUGIN_DIR/dist/server.cjs"
