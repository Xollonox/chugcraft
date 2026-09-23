#!/bin/sh
# Double-click on macOS. On Linux, run:  sh PLAY-MAC-LINUX.command
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Craftverse needs Node.js to run (it is free and takes a minute)."
  echo ""
  echo "    1. Go to  https://nodejs.org"
  echo "    2. Download the \"LTS\" version and install it."
  echo "    3. Double-click this file again."
  echo ""
  read -r _ 2>/dev/null
  exit 1
fi

echo ""
echo "  Starting Craftverse..."
echo "  Keep this window open while you play. Closing it stops the game."
echo ""
CRAFTVERSE_OPEN=1 node serve.js
