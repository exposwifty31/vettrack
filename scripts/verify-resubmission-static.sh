#!/usr/bin/env bash
# VetTrack — pre-archive resubmission verification: STATIC subset (Lane A).
#
# The Linux-CI-runnable half of scripts/verify-resubmission.sh. Every gate here
# reads only git-TRACKED files with portable tools (bash + grep + git + python3) —
# NO macOS-only tools (sips), NO network, NO secrets, NO build output. It therefore
# runs unchanged on an ubuntu CI runner, so the ripcord's static invariants are
# OBSERVABLE on every push/PR instead of rotting between manual Mac runs (R4).
#
# The Mac full run (verify-resubmission.sh) CALLS this script so these gates live in
# ONE place and cannot silently diverge from CI. The remaining gates — demo login,
# Clerk admin config, API CORS, AASA live fetch, and the build-output bundle checks
# (public/assets/* is gitignored) — stay Mac/network-only in that script.
#
# On success prints a machine-readable "STATIC_RESULT PASS=<n> FAIL=<m>" line the
# caller can fold into its own totals. Exit 0 only if every static gate passes.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO="${REPO:-$SCRIPT_REPO_ROOT}"
cd "$REPO" || { echo "FAIL: repo not found at $REPO"; exit 2; }

PASS=0; FAIL=0
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
hdr(){ echo; echo "== $1 =="; }

# --- [2.3.8] icon: alpha-stripped, 1024 (portable — no macOS `sips`) ----------
# Parse the PNG IHDR directly: width/height (big-endian uint32 at bytes 16/20) and
# color type (byte 25). Color type 4/6 carry an alpha channel; Apple rejects an
# icon with alpha. Pure stdlib so it runs on a Linux runner identically to the Mac.
hdr "[2.3.8] App icon"
ICON="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
if [ -f "$ICON" ]; then
  ICON_RESULT=$(python3 - "$ICON" <<'PY'
import struct, sys
p = sys.argv[1]
with open(p, "rb") as f:
    sig = f.read(8)
    if sig != b"\x89PNG\r\n\x1a\n":
        print("ERR not-a-png"); sys.exit(0)
    f.read(4)                       # IHDR length
    if f.read(4) != b"IHDR":
        print("ERR no-ihdr"); sys.exit(0)
    w, h = struct.unpack(">II", f.read(8))
    bit_depth = f.read(1)
    color_type = f.read(1)[0]
has_alpha = "yes" if color_type in (4, 6) else "no"
print(f"{w} {h} {has_alpha}")
PY
)
  read -r IW IH IA <<<"$ICON_RESULT"
  if [ "$IW" = "1024" ] && [ "$IH" = "1024" ] && [ "$IA" = "no" ]; then
    ok "icon ${IW}x${IH}px, hasAlpha=$IA"
  else
    no "icon ${IW:-?}x${IH:-?} hasAlpha=${IA:-?} (want 1024x1024 / no) [$ICON_RESULT]"
  fi
else
  no "icon file missing"
fi

# --- build number must exceed the last shipped build ------------------------
# Source of truth: ios/.last-shipped-build. Fail CLOSED on a missing/garbled
# baseline (the app is LIVE — a missing baseline is misconfiguration, not a first
# submission). Override the baseline via LAST_SHIPPED_BUILD for a one-off check.
hdr "[build number — must exceed last shipped]"
BN=$(grep -m1 'CURRENT_PROJECT_VERSION = ' ios/App/App.xcodeproj/project.pbxproj | grep -oE '[0-9]+' | head -1)
if [ -f ios/.last-shipped-build ]; then
  FILE_LAST=$(<ios/.last-shipped-build)
  FILE_LAST="${FILE_LAST#"${FILE_LAST%%[![:space:]]*}"}"
  FILE_LAST="${FILE_LAST%"${FILE_LAST##*[![:space:]]}"}"
else
  FILE_LAST=""
fi
LAST="${LAST_SHIPPED_BUILD:-${FILE_LAST:-}}"
if ! [[ "${BN:-}" =~ ^[0-9]+$ ]]; then
  no "could not parse a numeric CURRENT_PROJECT_VERSION from pbxproj (got '${BN:-<empty>}')"
elif [ -z "${LAST:-}" ]; then
  no "no last-shipped baseline (ios/.last-shipped-build absent and LAST_SHIPPED_BUILD unset) — record the last build uploaded to App Store Connect there before archiving"
elif ! [[ "$LAST" =~ ^[0-9]+$ ]]; then
  no "last-shipped baseline is not a number (got '$LAST') — fix ios/.last-shipped-build or the LAST_SHIPPED_BUILD env"
elif [ "$BN" -gt "$LAST" ]; then
  ok "build $BN > last shipped $LAST"
else
  no "build ${BN} must be > last shipped $LAST — bump first: pnpm resubmit  (then update ios/.last-shipped-build after upload)"
fi

# --- no literal CFBundleVersion in any SOURCE bundle plist (app + extensions) ----
# Every app/extension Info.plist must derive CFBundleVersion from $(CURRENT_PROJECT_VERSION).
# A literal integer desyncs from the app the moment resubmit's global build bump runs
# → ITMS-90473. Scoped to git-TRACKED plists so gitignored build output is never flagged.
hdr "[no literal CFBundleVersion in source bundle plists]"
LITERAL_PLISTS=""
while IFS= read -r plist; do
  [ -f "$plist" ] || continue
  val=$(grep -A1 '<key>CFBundleVersion</key>' "$plist" 2>/dev/null | sed -n '2p' | tr -d '[:space:]')
  case "$val" in
    *'<string>'[0-9]*) LITERAL_PLISTS="$LITERAL_PLISTS ${plist}=${val}" ;;
  esac
done < <(git ls-files ios/App 2>/dev/null | grep -E '/Info\.plist$')
if [ -z "$LITERAL_PLISTS" ]; then
  ok "all source bundle Info.plist CFBundleVersion values reference \$(CURRENT_PROJECT_VERSION)"
else
  no "literal CFBundleVersion in:$LITERAL_PLISTS — set to \$(CURRENT_PROJECT_VERSION) so the build bump can't desync an extension"
fi

# --- Control widget files ---------------------------------------------------
hdr "[Control widget]"
for f in ios/App/VetTrackControl/VetTrackScanControl.swift \
         ios/App/VetTrackControl/AppIntent+OpenScan.swift \
         ios/App/VetTrackControl/VetTrackControl.swift; do
  [ -f "$f" ] && ok "$(basename "$f") present" || no "$(basename "$f") MISSING"
done

# --- entitlements (static half of the AASA gate) ----------------------------
# The live AASA fetch stays in the Mac/network script; the entitlement is a tracked
# file, so its check belongs here.
hdr "[entitlements]"
grep -q 'applinks:vettrack.uk' ios/App/App/App.entitlements \
  && ok "entitlements applinks:vettrack.uk" || no "entitlements missing applinks:vettrack.uk"

# --- summary ----------------------------------------------------------------
echo; echo "============================================"
echo "  STATIC_RESULT PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ STATIC GATES PASS ($PASS)"
  echo "============================================"; exit 0
else
  echo "  ❌ STATIC GATES FAILED — fix the FAIL lines above."
  echo "============================================"; exit 1
fi
