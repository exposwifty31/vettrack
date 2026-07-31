#!/usr/bin/env bash
# VetTrack — pre-archive resubmission verification: STATIC subset (Lane A).
#
# The Linux-CI-runnable half of scripts/verify-resubmission.sh. Every gate here
# reads only git-TRACKED files with portable tools (bash + git + python3) — NO
# macOS-only tools (sips), NO network, NO secrets, NO build output. It therefore
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

# --- [2.3.8] icon: 1024², fully opaque (no macOS `sips`) ----------------------
# Apple rejects an icon with ANY transparency. Parse the PNG: IHDR gives dimensions
# (bytes 16/20) + color type (byte 25); color types 4/6 carry an alpha channel, AND
# a `tRNS` chunk adds transparency to color types 0/2/3 — reject either. Pure stdlib
# so it runs identically on Linux and Mac.
hdr "[2.3.8] App icon"
ICON="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
if [ -f "$ICON" ]; then
  ICON_RESULT=$(python3 - "$ICON" <<'PY'
import struct, sys
with open(sys.argv[1], "rb") as f:
    if f.read(8) != b"\x89PNG\r\n\x1a\n":
        print("ERR not-a-png"); sys.exit(0)
    ihdr_len = struct.unpack(">I", f.read(4))[0]
    if f.read(4) != b"IHDR":
        print("ERR no-ihdr"); sys.exit(0)
    w, h = struct.unpack(">II", f.read(8))
    f.read(1)                       # bit depth
    color_type = f.read(1)[0]
    f.seek((ihdr_len - 10) + 4, 1)  # rest of IHDR data + CRC
    has_trns = False
    while True:
        chunk_hdr = f.read(8)
        if len(chunk_hdr) < 8:
            break
        clen = struct.unpack(">I", chunk_hdr[:4])[0]
        ctype = chunk_hdr[4:8]
        if ctype == b"tRNS":
            has_trns = True
        if ctype == b"IEND":
            break
        f.seek(clen + 4, 1)         # chunk data + CRC
transparent = "yes" if (color_type in (4, 6) or has_trns) else "no"
print(f"{w} {h} {transparent}")
PY
)
  read -r IW IH IT <<<"$ICON_RESULT"
  if [ "$IW" = "1024" ] && [ "$IH" = "1024" ] && [ "$IT" = "no" ]; then
    ok "icon ${IW}x${IH}px, transparent=$IT"
  else
    no "icon ${IW:-?}x${IH:-?} transparent=${IT:-?} (want 1024x1024 / no; alpha channel OR tRNS rejected) [$ICON_RESULT]"
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

# --- every source bundle Info.plist CFBundleVersion == $(CURRENT_PROJECT_VERSION) ---
# A literal integer — or any OTHER build setting — desyncs from the app the moment
# the global build bump runs → ITMS-90473. Parse each tracked Info.plist with plistlib
# (not grep, which passes on a missing key or a value buried in a comment) and require
# the exact `$(CURRENT_PROJECT_VERSION)` reference.
hdr "[CFBundleVersion == \$(CURRENT_PROJECT_VERSION) in source bundle plists]"
BAD_PLISTS=$(python3 - <<'PY'
import plistlib, subprocess
WANT = "$(CURRENT_PROJECT_VERSION)"
tracked = subprocess.run(["git", "ls-files", "ios/App"], capture_output=True, text=True).stdout.split()
bad = []
for p in tracked:
    if not p.endswith("/Info.plist"):
        continue
    try:
        with open(p, "rb") as fh:
            d = plistlib.load(fh)
    except Exception as e:
        bad.append(f"{p}=UNREADABLE({e})")
        continue
    v = d.get("CFBundleVersion")
    if v != WANT:
        bad.append(f"{p}={v!r}")
print("\n".join(bad))
PY
)
if [ -z "$BAD_PLISTS" ]; then
  ok "every source bundle Info.plist CFBundleVersion == \$(CURRENT_PROJECT_VERSION)"
else
  no "CFBundleVersion not \$(CURRENT_PROJECT_VERSION) (or key missing) in: $(echo $BAD_PLISTS) — set it to the build-setting reference so the build bump can't desync an extension"
fi

# --- Control widget files ---------------------------------------------------
hdr "[Control widget]"
for f in ios/App/VetTrackControl/VetTrackScanControl.swift \
         ios/App/VetTrackControl/AppIntent+OpenScan.swift \
         ios/App/VetTrackControl/VetTrackControl.swift; do
  [ -f "$f" ] && ok "$(basename "$f") present" || no "$(basename "$f") MISSING"
done

# --- entitlements (static half of the AASA gate) ----------------------------
# Parse the entitlement plist and require applinks:vettrack.uk as an actual member of
# the associated-domains array — not a substring match that a comment could satisfy.
# The live AASA fetch stays in the Mac/network script.
hdr "[entitlements]"
ENT_OK=$(python3 -c "
import plistlib
d = plistlib.load(open('ios/App/App/App.entitlements', 'rb'))
domains = d.get('com.apple.developer.associated-domains') or []
print('yes' if 'applinks:vettrack.uk' in domains else 'no|' + repr(domains))
" 2>/dev/null)
if [ "$ENT_OK" = "yes" ]; then
  ok "entitlements associated-domains contains applinks:vettrack.uk"
else
  no "entitlements associated-domains missing applinks:vettrack.uk (${ENT_OK#no|})"
fi

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
