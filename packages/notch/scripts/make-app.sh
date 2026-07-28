#!/usr/bin/env bash
# Build RemoteAgentNotch.app from the SwiftPM executable.
# Dev loop: `swift run` works without bundling (no launch-at-login support).
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release

APP="build/Remote Agent Notch.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/RemoteAgentNotch "$APP/Contents/MacOS/"
cp Info.plist "$APP/Contents/Info.plist"

# Ad-hoc signature so TCC/Keychain treat the app as a stable identity
codesign --force -s - "$APP"

echo "Built $APP"
