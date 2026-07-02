#!/usr/bin/env bash
# Build and install the bundled VetTrack iOS app on a simulator.
#
# Usage:
#   ./scripts/install-ios-sim.sh                    # iPad (A16) default
#   ./scripts/install-ios-sim.sh --udid <UDID>
#   ./scripts/install-ios-sim.sh --skip-build       # reuse last native shell sync
#   ./scripts/install-ios-sim.sh --iphone           # newest available iPhone Pro sim
set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

SKIP_BUILD=false
# Default: iPad (A16) — matches native-ship-checklist iPad matrix target
UDID="${IOS_SIM_UDID:-DA8D1142-E500-43D7-84C8-8678BD1B3542}"
APP_ID="uk.vettrack.app"
DERIVED_DATA="${IOS_DERIVED_DATA:-build/ios-sim}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=true; shift ;;
    --udid) UDID="$2"; shift 2 ;;
    --iphone)
      for model in 'iPhone 17 Pro' 'iPhone 16 Pro' 'iPhone 15 Pro'; do
        UDID="$(xcrun simctl list devices available 2>/dev/null | grep -m1 "$model (" | grep -oE '[A-F0-9-]{36}' || true)"
        if [[ -n "$UDID" ]]; then break; fi
      done
      if [[ -z "$UDID" ]]; then
        echo "FAIL: could not find an iPhone Pro simulator — pass --udid" >&2
        exit 1
      fi
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--skip-build] [--udid UUID] [--iphone]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! $SKIP_BUILD; then
  bash "$REPO/scripts/build-native-shell.sh" --ios
fi

echo "== Boot simulator $UDID =="
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b 2>/dev/null || true

echo "== xcodebuild (Debug / simulator) =="
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination "id=$UDID" \
  -derivedDataPath "$DERIVED_DATA" \
  build

APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/App.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "FAIL: App.app not found at $APP_PATH" >&2
  exit 1
fi

echo "== Install + launch =="
xcrun simctl install "$UDID" "$APP_PATH"
xcrun simctl launch "$UDID" "$APP_ID"
open -a Simulator

echo "Installed VetTrack on simulator $UDID"
