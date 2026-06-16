#!/usr/bin/env bash
# VetTrack — production bundled Capacitor shell (Clerk + remote API baked in).
#
# Reads VITE_CLERK_PUBLISHABLE_KEY and VITE_API_ORIGIN from .env only (ignores .env.local).
# Never sets CAPACITOR_SERVER_URL — that would ship a thin web wrapper (App Review 4.2 + OAuth break).
#
# Usage:
#   ./scripts/build-native-shell.sh              # ios only (default)
#   ./scripts/build-native-shell.sh --android
#   ./scripts/build-native-shell.sh --all
set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

# shellcheck source=scripts/lib/native-shell-env.sh
source "$REPO/scripts/lib/native-shell-env.sh"

SYNC_IOS=true
SYNC_ANDROID=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ios) SYNC_IOS=true; SYNC_ANDROID=false; shift ;;
    --android) SYNC_IOS=false; SYNC_ANDROID=true; shift ;;
    --all) SYNC_IOS=true; SYNC_ANDROID=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--ios|--android|--all]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

native_shell_load_build_env

echo "== VetTrack native shell build =="
echo "  env file:              ${NATIVE_SHELL_ENV_FILE:-.env}"
echo "  VITE_API_ORIGIN:       $VITE_API_ORIGIN"
echo "  VITE_CLERK_PUBLISHABLE: $(native_shell_key_prefix "$VITE_CLERK_PUBLISHABLE_KEY")"
echo "  CAPACITOR_SERVER_URL:  (unset — bundled shell)"
echo

if [[ "$VITE_CLERK_PUBLISHABLE_KEY" != pk_live_* ]]; then
  echo "WARN: publishable key is not pk_live_* — OK for staging; use pk_live for App Store archive." >&2
fi

VITE_CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY" \
  VITE_API_ORIGIN="$VITE_API_ORIGIN" \
  pnpm exec vite build

if $SYNC_IOS; then
  echo "== cap sync ios =="
  env -u CAPACITOR_SERVER_URL npx cap sync ios
fi

if $SYNC_ANDROID; then
  echo "== cap sync android =="
  env -u CAPACITOR_SERVER_URL npx cap sync android
fi

echo
echo "Done. Next:"
echo "  Simulator:  ./scripts/install-ios-sim.sh"
echo "  Archive:    ./scripts/verify-resubmission.sh && pnpm cap:open:ios"
