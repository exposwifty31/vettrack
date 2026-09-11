#!/usr/bin/env bash
# VetTrack — App Store Connect build-number oracle for the SHARED CFBundleVersion counter.
#
# This repo (Capacitor shell) and the RN lane (VetTrack---RN-Migration-, EAS) both
# upload under bundle id uk.vettrack.app, so they burn ONE build-number sequence on
# App Store Connect. Each lane keeps an offline record of the highest number ASC
# accepted (here: ios/.last-shipped-build), and on 2026-09-02 both records said 29
# while ASC already held 30 — the RN lane's upload. Both offline gates stayed green
# on a burnt number for a week. Only the store sees both lanes, so this script asks
# the store and makes the record a MIRROR it rewrites with printed proof.
#
#   store-build-max.sh            print ASC_MAX=<n> COUNT=<builds> LATEST=<v>@<uploaded>/<state>
#   store-build-max.sh --sync     also raise ios/.last-shipped-build to ASC_MAX when it is BEHIND
#
# Exit codes: 0 ok · 2 oracle unavailable (no asc on PATH, asc failed, non-JSON,
# zero builds — never "max=0") · 1 (--sync only) the record is AHEAD of the store:
# it claims an acceptance the store never made (wrong ASC_APP_ID, wrong key, or a
# guess) and is refused, never lowered automatically.
#
# Env: ASC_APP_ID (default 6778937527 — the VetTrack app record), REPO (default:
# this script's repo root). Requires the `asc` CLI authenticated on this Mac
# (`asc auth status`); bash + python3, no jq (the resubmission lane's doctrine).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ASC_APP_ID="${ASC_APP_ID:-6778937527}"
RECORD="$REPO/ios/.last-shipped-build"
SYNC=0
for a in "$@"; do
  case "$a" in
    --sync) SYNC=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "FAIL: unknown argument '$a' (usage: store-build-max.sh [--sync])"; exit 2 ;;
  esac
done

command -v asc >/dev/null 2>&1 || {
  echo "FAIL: the asc CLI is not on PATH — install it (brew install ...asc) and authenticate (asc auth login), then re-run"; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "FAIL: python3 required"; exit 2; }

# Every build counts: an EXPIRED build and a FAILED/INVALID upload still burnt their
# number, so no --exclude-expired and no processing-state filter.
ASC_ARGS=(builds list --app "$ASC_APP_ID" --platform IOS --paginate --output json)
ASC_ERR="$(mktemp "${TMPDIR:-/tmp}/asc-err.XXXXXX")" || { echo "FAIL: could not create temp file"; exit 2; }
trap 'rm -f "$ASC_ERR"' EXIT
ASC_OUT="$(asc "${ASC_ARGS[@]}" 2>"$ASC_ERR")"
ASC_STATUS=$?
if [ "$ASC_STATUS" -ne 0 ]; then
  echo "FAIL: asc ${ASC_ARGS[*]} exited $ASC_STATUS — $(head -c 300 "$ASC_ERR" | tr '\n' ' ')"
  echo "      check: asc auth status"
  exit 2
fi

# Parse with python3: the JSON envelope is {data:[{attributes:{version,...}}]};
# max by dotted-numeric tuple, so "30.1" > "30" and "9" < "10".
SUMMARY="$(printf '%s' "$ASC_OUT" | python3 -c '
import json, sys
try:
    j = json.load(sys.stdin)
except Exception as e:
    print("FAIL: asc printed non-JSON (" + type(e).__name__ + ")"); sys.exit(2)
data = j.get("data") if isinstance(j, dict) else None
if not isinstance(data, list):
    print("FAIL: asc JSON has no data array"); sys.exit(2)
rows = []
for b in data:
    a = b.get("attributes", {}) if isinstance(b, dict) else {}
    v = str(a.get("version", "")).strip()
    parts = v.split(".")
    if not v or not all(p.isdigit() for p in parts):
        print("FAIL: build with non-numeric version " + repr(v)); sys.exit(2)
    rows.append((tuple(int(p) for p in parts), v, str(a.get("uploadedDate", "")), str(a.get("processingState", ""))))
if not rows:
    print("FAIL: asc returned zero builds for app " + sys.argv[1] + " — this app has dozens; zero means the wrong app id or key, not an empty store"); sys.exit(2)
top = max(rows)
print("ASC_MAX=%s COUNT=%d LATEST=%s@%s/%s" % (top[1], len(rows), top[1], top[2], top[3]))
' "$ASC_APP_ID")"
PY_STATUS=$?
if [ "$PY_STATUS" -ne 0 ]; then echo "$SUMMARY"; exit 2; fi
echo "$SUMMARY"
ASC_MAX="${SUMMARY#ASC_MAX=}"; ASC_MAX="${ASC_MAX%% *}"
PROOF="asc builds list --app $ASC_APP_ID --paginate → max version $ASC_MAX (${SUMMARY#*LATEST=}), ${SUMMARY#*COUNT=}"
PROOF="${PROOF%% LATEST=*} builds"

[ "$SYNC" -eq 1 ] || exit 0

# --- --sync: reconcile ios/.last-shipped-build with the store -------------------
# Same trim rules as verify-resubmission-static.sh: SURROUNDING whitespace only, so an
# internally-malformed "2 8" fails instead of collapsing to 28.
if [ -f "$RECORD" ]; then
  REC="$(<"$RECORD")"
  REC="${REC#"${REC%%[![:space:]]*}"}"; REC="${REC%"${REC##*[![:space:]]}"}"
else
  REC=""
fi
cmp_versions() { # prints -1 / 0 / 1 for $1 vs $2, dotted-numeric
  python3 -c '
import sys
a=[int(p) for p in sys.argv[1].split(".")]; b=[int(p) for p in sys.argv[2].split(".")]
n=max(len(a),len(b)); a+= [0]*(n-len(a)); b+= [0]*(n-len(b))
print(-1 if a<b else (1 if a>b else 0))' "$1" "$2"
}
if [ -z "$REC" ] || ! [[ "$REC" =~ ^[0-9]+(\.[0-9]+)*$ ]]; then
  echo "RECORD <unreadable: '${REC:-<missing>}'> -> $ASC_MAX  proof: $PROOF"
  printf '%s\n' "$ASC_MAX" > "$RECORD"
  exit 0
fi
case "$(cmp_versions "$REC" "$ASC_MAX")" in
  0)  echo "in sync: ios/.last-shipped-build ($REC) == App Store Connect max ($ASC_MAX)"; exit 0 ;;
  -1) printf '%s\n' "$ASC_MAX" > "$RECORD"
      echo "RECORD $REC -> $ASC_MAX  proof: $PROOF"; exit 0 ;;
  1)  echo "FAIL: ios/.last-shipped-build ($REC) is AHEAD of App Store Connect ($ASC_MAX) — the record claims an upload the store never accepted. Check ASC_APP_ID / the key, then fix the file by hand; this script never lowers it."; exit 1 ;;
esac
