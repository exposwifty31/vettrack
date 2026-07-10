#!/usr/bin/env bash
# VetTrack — pre-archive resubmission verification (runbook §C, consolidated)
# Run on the Mac. Requires network to clerk.vettrack.uk + the Clerk secret key.
# Exit 0 only if every gate passes. Any FAIL exits non-zero.
set -uo pipefail

REPO="${REPO:-/Users/dan/vettrack}"
cd "$REPO" || { echo "FAIL: repo not found at $REPO"; exit 2; }

# --- secret -----------------------------------------------------------------
if [ -z "${CLERK_SECRET_KEY:-}" ] && [ -f "$REPO/.env" ]; then
  # Same source the server + build-native-shell already read (gitignored).
  # sk_live only: these gates audit the PRODUCTION instance — a dev sk_test
  # key would silently check the wrong instance and pass/fail falsely.
  ENV_SK=$(grep -m1 '^CLERK_SECRET_KEY=' "$REPO/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
  case "$ENV_SK" in
    sk_live_*) CLERK_SECRET_KEY="$ENV_SK" ;;
    sk_*) echo "  note: .env CLERK_SECRET_KEY is not sk_live_ (dev instance) — ignoring for prod gates" ;;
  esac
fi
if [ -z "${CLERK_SECRET_KEY:-}" ]; then
  # Try to pull from Railway (project pacific-flow / service VetTrack)
  CLERK_SECRET_KEY=$(cd /Users/dan/.vt-deploy 2>/dev/null && \
    railway variables --json 2>/dev/null | \
    python3 -c "import json,sys;print(json.load(sys.stdin).get('CLERK_SECRET_KEY',''))" 2>/dev/null)
fi
SK="${CLERK_SECRET_KEY:-}"

PASS=0; FAIL=0
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }
no(){ echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
hdr(){ echo; echo "== $1 =="; }

# --- [2.1] demo login must COMPLETE (the #1 re-rejection risk) ---------------
hdr "[2.1] Demo login (must be 'complete')"
curl -s -D /tmp/vt_h.txt -X POST \
  "https://clerk.vettrack.uk/v1/client/sign_ins?_is_native=1&_clerk_js_version=5.125.13" \
  -H "Origin: capacitor://localhost" -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "identifier=reviewer@vettrack.uk" -o /tmp/vt_si.json
JWT=$(grep -i "^authorization:" /tmp/vt_h.txt | cut -d' ' -f2 | tr -d '\r')
SID=$(python3 -c "import json;print(json.load(open('/tmp/vt_si.json'))['response']['id'])" 2>/dev/null)
if [ -z "$SID" ]; then no "could not start sign-in (FAPI unreachable or 429 — wait ~3 min)";
else
  STATUS=$(curl -s -X POST \
    "https://clerk.vettrack.uk/v1/client/sign_ins/${SID}/attempt_first_factor?_is_native=1" \
    -H "Origin: capacitor://localhost" -H "Authorization: ${JWT}" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "strategy=password" --data-urlencode "password=VetTrack2026!" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('response',{}).get('status','?'))" 2>/dev/null)
  if [ "$STATUS" = "complete" ]; then ok "login status = complete";
  else no "login status = '$STATUS' (needs_client_trust => Client Trust is back ON, see §G)"; fi
fi

# --- [2.1a] Clerk config gating Apple/Google sign-up ------------------------
hdr "[2.1a] Clerk redirect URL + allowed origins"
if [ -z "$SK" ]; then no "CLERK_SECRET_KEY not set — cannot check Clerk admin config";
else
  R=$(curl -s https://api.clerk.com/v1/redirect_urls -H "Authorization: Bearer $SK" \
    | python3 -c "import json,sys;u=[r['url'] for r in json.load(sys.stdin)];print('vettrack://oauth-callback' in u)" 2>/dev/null)
  [ "$R" = "True" ] && ok "redirect URL vettrack://oauth-callback present" || no "redirect URL vettrack://oauth-callback MISSING"
  O=$(curl -s https://api.clerk.com/v1/instance -H "Authorization: Bearer $SK" \
    | python3 -c "import json,sys;o=json.load(sys.stdin).get('allowed_origins') or [];print('capacitor://localhost' in o)" 2>/dev/null)
  [ "$O" = "True" ] && ok "allowed_origins includes capacitor://localhost" || no "allowed_origins MISSING capacitor://localhost"
fi

# --- [2.1b] API CORS for bundled Capacitor shell --------------------------------
hdr "[2.1b] API CORS — /api/version allows capacitor://localhost"
ACAO=$(curl -sSI -H "Origin: capacitor://localhost" "https://vettrack.uk/api/version" \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}' | head -1)
if [ "$ACAO" = "capacitor://localhost" ]; then
  ok "/api/version ACAO = capacitor://localhost"
else
  no "/api/version ACAO = '${ACAO:-<missing>}' (deploy server fix: /api/version after CORS middleware)"
fi

# --- [2.3.8] icon: alpha-stripped, 1024 -------------------------------------
hdr "[2.3.8] App icon"
ICON="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
if [ -f "$ICON" ]; then
  A=$(sips -g hasAlpha "$ICON" | awk '/hasAlpha/{print $2}')
  W=$(sips -g pixelWidth "$ICON" | awk '/pixelWidth/{print $2}')
  [ "$A" = "no" ] && [ "$W" = "1024" ] && ok "icon $W px, hasAlpha=$A" || no "icon W=$W hasAlpha=$A (want 1024 / no)"
else no "icon file missing"; fi

# --- build number must exceed the last shipped build ------------------------
# The app is LIVE, so the old fixed ">=4" floor is meaningless (always passes).
# App Store Connect rejects a duplicate CFBundleVersion within a marketing
# version, so each submission MUST be strictly greater than the last one shipped.
# Source of truth: ios/.last-shipped-build (the owner updates it after a
# successful upload; `resubmit.sh` prints the reminder). Override via
# LAST_SHIPPED_BUILD env for a one-off check.
hdr "[build number — must exceed last shipped]"
BN=$(grep -m1 'CURRENT_PROJECT_VERSION = ' ios/App/App.xcodeproj/project.pbxproj | grep -oE '[0-9]+' | head -1)
# Read the WHOLE baseline file (stripping surrounding whitespace) — do NOT grep out
# the first digit run. A malformed file like "build-25-old" must fail the `^[0-9]+$`
# check below (fail closed), not silently parse to "25".
FILE_LAST=$(tr -d '[:space:]' < ios/.last-shipped-build 2>/dev/null || true)
LAST="${LAST_SHIPPED_BUILD:-${FILE_LAST:-}}"
# Validate both integers before the numeric compare. BN comes from a parsed
# pbxproj; LAST can come from a hand-set LAST_SHIPPED_BUILD env or a garbled
# baseline file. A non-numeric value must FAIL the gate — not skew `-gt` (which
# errors/misbehaves on non-ints) or slip through a `${x:-0}` default.
if ! [[ "${BN:-}" =~ ^[0-9]+$ ]]; then
  no "could not parse a numeric CURRENT_PROJECT_VERSION from pbxproj (got '${BN:-<empty>}')"
elif [ -z "${LAST:-}" ]; then
  # Fail CLOSED. The app is LIVE, so a missing baseline is a misconfiguration,
  # not a first submission — without it the "must exceed last shipped" rule can't
  # be evaluated, and passing anyway could wave a duplicate CFBundleVersion through.
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
# A literal integer (e.g. the VetTrackControl widget) desyncs from the app the moment
# resubmit.sh's global build bump runs → ITMS-90473 upload rejection. Scoped to
# git-TRACKED plists so build output (xcarchive / DerivedData / vendored frameworks,
# all gitignored — their literal versions are correct and not ours) is never flagged.
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

# --- bundled shell + native clerk chunk -------------------------------------
hdr "[bundled shell]"
B=$(python3 -c "import json;c=json.load(open('ios/App/App/capacitor.config.json'));print('server' not in c or not c.get('server',{}).get('url'))" 2>/dev/null)
[ "$B" = "True" ] && ok "bundled (no server.url)" || no "capacitor.config has server.url — thin wrapper risk (4.2 + OAuth breaks)"
ls ios/App/App/public/assets/clerk-native-instance-*.js >/dev/null 2>&1 \
  && ok "native Clerk chunk present" || no "native Clerk chunk MISSING (run ./scripts/build-native-shell.sh)"

# --- bundled auth env (pk_live + API origin — NOT dev-bypass from .env.local) ---
hdr "[native bundle auth]"
ASSETS="ios/App/App/public/assets"
if [ -d "$ASSETS" ]; then
  if ls "$ASSETS"/index-*.js >/dev/null 2>&1; then
    grep -q 'pk_live' "$ASSETS"/index-*.js 2>/dev/null \
      && ok "Clerk pk_live baked into bundle" \
      || no "pk_live missing — dev-bypass shell (use ./scripts/build-native-shell.sh, not pnpm build)"
    grep -q 'https://vettrack.uk' "$ASSETS"/index-*.js 2>/dev/null \
      && ok "VITE_API_ORIGIN baked (vettrack.uk)" \
      || no "vettrack.uk missing from bundle — /api will hit capacitor://localhost"
  else
    no "no index-*.js in $ASSETS — run ./scripts/build-native-shell.sh"
  fi
  SIGNIN=$(ls "$ASSETS"/signin-*.js 2>/dev/null | head -1)
  if [ -n "${SIGNIN:-}" ]; then
    SZ=$(wc -c < "$SIGNIN" | tr -d ' ')
    [ "$SZ" -gt 8000 ] \
      && ok "signin chunk ${SZ}B (Clerk UI)" \
      || no "signin chunk ${SZ}B — likely dev-bypass (expect >8KB; rebuild with build-native-shell.sh)"
  else
    no "signin-*.js missing in bundled assets"
  fi
else
  no "bundled assets dir missing — run ./scripts/build-native-shell.sh"
fi

# --- Control widget files ---------------------------------------------------
hdr "[Control widget]"
for f in ios/App/VetTrackControl/VetTrackScanControl.swift \
         ios/App/VetTrackControl/AppIntent+OpenScan.swift \
         ios/App/VetTrackControl/VetTrackControl.swift; do
  [ -f "$f" ] && ok "$(basename "$f") present" || no "$(basename "$f") MISSING"
done

# --- AASA live + entitlements -----------------------------------------------
hdr "[AASA + entitlements]"
if curl -sS https://vettrack.uk/.well-known/apple-app-site-association -o /tmp/vt_aasa.json 2>/dev/null; then
  python3 -c "
import json, sys
d = json.load(open('/tmp/vt_aasa.json'))
details = d.get('applinks', {}).get('details', [])
app_ids = details[0].get('appIDs', []) if details else []
components = details[0].get('components', []) if details else []
has_app = '87F5G378M6.uk.vettrack.app' in app_ids
has_path = any(c.get('/') == '/equipment/*' for c in components)
sys.exit(0 if has_app and has_path else 1)
" && ok "AASA appID + /equipment/* path" || no "AASA JSON missing appID or /equipment/* (see server/index.ts)"
else
  no "AASA curl failed"
fi
grep -q 'applinks:vettrack.uk' ios/App/App/App.entitlements \
  && ok "entitlements applinks:vettrack.uk" || no "entitlements missing applinks:vettrack.uk"

# --- summary ----------------------------------------------------------------
echo; echo "============================================"
echo "  PASS: $PASS   FAIL: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ ALL GATES PASS — safe to archive (runbook §D)."
  echo "============================================"; exit 0
else
  echo "  ❌ DO NOT ARCHIVE — fix the FAIL lines above (runbook §G/§H)."
  echo "============================================"; exit 1
fi
