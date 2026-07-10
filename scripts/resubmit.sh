#!/usr/bin/env bash
# VetTrack — App Store version bump + pre-archive verify (Phase 10.B).
#
# The app is LIVE, so every submission is an update. Two modes:
#
#   ./scripts/resubmit.sh --resubmit
#       Same marketing version, new binary (App Store re-upload / rejection fix).
#       Bumps the BUILD only: CURRENT_PROJECT_VERSION n -> n+1 (+ CFBundleVersion,
#       which now references it). Satisfies App Store Connect's "each binary needs a
#       higher CFBundleVersion within the version" rule. Also aligns the iOS
#       MARKETING_VERSION to package.json (the single source of truth) if it drifted.
#
#   ./scripts/resubmit.sh --release <MAJOR.MINOR.PATCH>
#       New product version (new work shipped). YOU pick the target — patch/minor/
#       major per the actual scope; reserve major for releases that warrant it (no
#       auto-increment). Sets MARKETING_VERSION / CFBundleShortVersionString +
#       package.json to <target>, and seeds the build to n+1 too.
#
# Single-sources the version across: package.json (marketing) · pbxproj
# (CURRENT_PROJECT_VERSION + MARKETING_VERSION) · Info.plist CFBundleVersion
# ($(CURRENT_PROJECT_VERSION), no literal). Then runs verify-resubmission.sh.
#
# This script edits VERSION FIELDS ONLY — no app logic. Native builds still go
# through scripts/build-native-shell.sh; the OWNER runs the archive/upload. Mac +
# python3 required. (The project has no VERSIONING_SYSTEM=apple-generic, so this
# edits the pbxproj directly rather than via agvtool — same result, portable.)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PBXPROJ="$REPO/ios/App/App.xcodeproj/project.pbxproj"
PLIST="$REPO/ios/App/App/Info.plist"
PKG="$REPO/package.json"
LAST_SHIPPED_FILE="$REPO/ios/.last-shipped-build"

usage() { echo "usage: resubmit.sh --resubmit | --release <MAJOR.MINOR.PATCH>"; exit 2; }

MODE=""; TARGET=""
case "${1:-}" in
  --resubmit) MODE="resubmit" ;;
  --release)  MODE="release"; TARGET="${2:-}"
              [ -n "$TARGET" ] || { echo "FAIL: --release needs a target version (e.g. 1.2.0)"; usage; } ;;
  *) usage ;;
esac
if [ "$MODE" = "release" ] && ! echo "$TARGET" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "FAIL: target version '$TARGET' is not MAJOR.MINOR.PATCH"; exit 2
fi

command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 required"; exit 2; }
# Preflight EVERY file we write, up front — so a missing one aborts before any
# edit lands, never mid-bump (which would leave pbxproj bumped but plist stale).
[ -f "$PBXPROJ" ] || { echo "FAIL: pbxproj not found ($PBXPROJ)"; exit 2; }
[ -f "$PLIST" ]   || { echo "FAIL: Info.plist not found ($PLIST)"; exit 2; }
[ -f "$PKG" ]     || { echo "FAIL: package.json not found ($PKG)"; exit 2; }

CUR_BUILD=$(grep -m1 'CURRENT_PROJECT_VERSION = ' "$PBXPROJ" | grep -oE '[0-9]+' | head -1)
[[ "${CUR_BUILD:-}" =~ ^[0-9]+$ ]] || { echo "FAIL: could not parse CURRENT_PROJECT_VERSION from pbxproj (got '${CUR_BUILD:-<empty>}')"; exit 2; }
CUR_MKT=$(grep -m1 'MARKETING_VERSION = ' "$PBXPROJ" | sed -E 's/.*MARKETING_VERSION = ([^;]+);.*/\1/')
PKG_VER=$(python3 -c "import json;print(json.load(open('$PKG'))['version'])")
NEW_BUILD=$((CUR_BUILD + 1))
if [ "$MODE" = "resubmit" ]; then NEW_MKT="$PKG_VER"; else NEW_MKT="$TARGET"; fi

echo "== resubmit ($MODE) =="
echo "  build:     $CUR_BUILD -> $NEW_BUILD"
echo "  marketing: iOS=$CUR_MKT  package.json=$PKG_VER  -> $NEW_MKT"

# --- edit pbxproj (all targets), package.json, and Info.plist deterministically ---
python3 - "$PBXPROJ" "$PLIST" "$PKG" "$NEW_BUILD" "$NEW_MKT" <<'PY'
import json, os, re, sys
pbx, plist, pkg, build, mkt = sys.argv[1:6]

# --- STAGE: compute + validate every edit in memory before touching any file.
# A zero-match substitution means the field moved/renamed — fail loudly rather
# than silently reporting a bump that didn't happen.
s = open(pbx).read()
s, n_build = re.subn(r'CURRENT_PROJECT_VERSION = [0-9]+;', f'CURRENT_PROJECT_VERSION = {build};', s)
s, n_mkt   = re.subn(r'MARKETING_VERSION = [0-9][0-9.]*;', f'MARKETING_VERSION = {mkt};', s)
if n_build == 0: sys.exit("FAIL: no CURRENT_PROJECT_VERSION found in pbxproj — nothing written")
if n_mkt == 0:   sys.exit("FAIL: no MARKETING_VERSION found in pbxproj — nothing written")

p = open(plist).read()
# CFBundleVersion must reference the pbxproj var (never a literal, so it can't drift).
p, n_plist = re.subn(r'(<key>CFBundleVersion</key>\s*<string>)[^<]*(</string>)',
                     r'\g<1>$(CURRENT_PROJECT_VERSION)\g<2>', p)
if n_plist == 0: sys.exit("FAIL: no CFBundleVersion key found in Info.plist — nothing written")

d = json.load(open(pkg)); d['version'] = mkt
pkg_out = json.dumps(d, indent=2) + "\n"

# --- COMMIT: all three staged; write each atomically (tmp on same dir + os.replace)
# so an interruption can't leave a half-written file, only an all-or-per-file swap.
def atomic_write(path, data):
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        f.write(data)
    os.replace(tmp, path)

atomic_write(pbx, s)
atomic_write(plist, p)
atomic_write(pkg, pkg_out)
PY

echo "  applied:"
echo "    $(grep -m1 'CURRENT_PROJECT_VERSION = ' "$PBXPROJ" | tr -d '\t')"
echo "    $(grep -m1 'MARKETING_VERSION = ' "$PBXPROJ" | tr -d '\t')"
echo "    package.json version = $(python3 -c "import json;print(json.load(open('$PKG'))['version'])")"

# --- pre-archive verification (bump -> verify -> archive-ready) ---
echo; echo "== verify-resubmission.sh =="
if REPO="$REPO" bash "$SCRIPT_DIR/verify-resubmission.sh"; then
  echo
  echo "✅ resubmit OK — build=$NEW_BUILD marketing=$NEW_MKT."
  echo "   Next: pnpm cap:build:native  →  archive/upload in Xcode (runbook §D)."
  echo "   After a SUCCESSFUL App Store upload, record it:  echo $NEW_BUILD > $LAST_SHIPPED_FILE"
else
  echo
  echo "⚠️  Version bump applied, but verify-resubmission FAILED — fix the gates above"
  echo "    before archiving (runbook §G/§H). The bump itself is committed-ready."
  exit 1
fi
