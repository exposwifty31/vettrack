#!/usr/bin/env bash
# VetTrack — pre-archive resubmission verification (runbook §C, consolidated)
# Run on the Mac. Requires network to clerk.vettrack.uk + the Clerk secret key.
# Exit 0 only if every gate passes. Any FAIL exits non-zero.
set -uo pipefail

# Resolve this script's own repo root (the checkout containing THIS file) and use
# it as the default REPO. A stale hardcoded default would cd into a different/older
# checkout, reading CURRENT_PROJECT_VERSION and the last-shipped baseline from the
# wrong tree and false-failing the build-number gate. Still overridable via $REPO.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO="${REPO:-$SCRIPT_REPO_ROOT}"
cd "$REPO" || { echo "FAIL: repo not found at $REPO"; exit 2; }

# Private temp dir (0700, unpredictable name) for the response bodies + the sign-in
# JWT this script writes — never predictable world-readable /tmp paths another local
# user could read or pre-create/symlink. Removed on exit.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/vt-resubmit.XXXXXX")" || { echo "FAIL: could not create temp dir"; exit 2; }
trap 'rm -rf "$TMP"' EXIT

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

# --- static gates (Lane A) — delegated to ONE shared source ------------------
# The Linux-CI-runnable subset (icon, build number, source-plist literals, widget
# files, entitlements) lives in scripts/verify-resubmission-static.sh so CI and this
# Mac run cannot silently diverge (R4). Fold its PASS/FAIL into this run's totals.
hdr "[static gates → scripts/verify-resubmission-static.sh]"
STATIC_OUT="$(REPO="$REPO" bash "$SCRIPT_DIR/verify-resubmission-static.sh")"
echo "$STATIC_OUT"
SP=$(printf '%s\n' "$STATIC_OUT" | sed -n 's/.*STATIC_RESULT PASS=\([0-9]*\) FAIL=\([0-9]*\).*/\1/p' | tail -1)
SF=$(printf '%s\n' "$STATIC_OUT" | sed -n 's/.*STATIC_RESULT PASS=\([0-9]*\) FAIL=\([0-9]*\).*/\2/p' | tail -1)
if [ -n "$SP" ] && [ -n "$SF" ]; then
  PASS=$((PASS + SP)); FAIL=$((FAIL + SF))
else
  no "static-gate script did not report a STATIC_RESULT line (missing or unrunnable)"
fi

# --- demo-reviewer credential (NEVER hardcoded) ------------------------------
# The password comes from the REVIEWER_PASSWORD env — keep it in your password
# manager (it also goes into the App Store Connect review notes), never in the repo.
# Email defaults to the demo account identifier (not a secret). If the account
# password is ever rotated in Clerk, only the env value changes; this script carries
# nothing to leak.
REVIEWER_EMAIL="${REVIEWER_EMAIL:-reviewer@vettrack.uk}"
REVIEWER_PASSWORD="${REVIEWER_PASSWORD:-}"

# --- [2.1] demo login must COMPLETE (the #1 re-rejection risk) ---------------
hdr "[2.1] Demo login (must be 'complete')"
if [ -z "$REVIEWER_PASSWORD" ]; then
  no "REVIEWER_PASSWORD not set — export it (from your password manager) before running; demo-login gate skipped"
else
  curl -s -D "$TMP/h.txt" -X POST \
    "https://clerk.vettrack.uk/v1/client/sign_ins?_is_native=1&_clerk_js_version=5.125.13" \
    -H "Origin: capacitor://localhost" -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "identifier=$REVIEWER_EMAIL" -o "$TMP/si.json"
  JWT=$(grep -i "^authorization:" "$TMP/h.txt" | cut -d' ' -f2 | tr -d '\r')
  SID=$(python3 -c "import json;print(json.load(open('$TMP/si.json'))['response']['id'])" 2>/dev/null)
  if [ -z "$SID" ]; then no "could not start sign-in (FAPI unreachable or 429 — wait ~3 min)";
  else
    STATUS=$(curl -s -X POST \
      "https://clerk.vettrack.uk/v1/client/sign_ins/${SID}/attempt_first_factor?_is_native=1" \
      -H "Origin: capacitor://localhost" -H "Authorization: ${JWT}" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      --data-urlencode "strategy=password" --data-urlencode "password=$REVIEWER_PASSWORD" \
      | python3 -c "import json,sys;print(json.load(sys.stdin).get('response',{}).get('status','?'))" 2>/dev/null)
    if [ "$STATUS" = "complete" ]; then ok "login status = complete";
    else no "login status = '$STATUS' (needs_client_trust => Client Trust is back ON, see §G)"; fi
  fi
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

# --- AASA live (entitlements check moved to verify-resubmission-static.sh) ---
hdr "[AASA + entitlements]"
if curl -sS https://vettrack.uk/.well-known/apple-app-site-association -o "$TMP/aasa.json" 2>/dev/null; then
  python3 -c "
import json, sys
d = json.load(open('$TMP/aasa.json'))
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
