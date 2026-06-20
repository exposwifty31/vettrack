#!/usr/bin/env bash
# VetTrack — pre-archive gate for the ship worktree only.
#
# Refuses dirty dev/ship trees, runs verify-resubmission (16 gates), then build-native-shell.
# Does NOT open Xcode or upload to App Store Connect — human archives after this passes.
#
# Usage:
#   ./scripts/archive-from-clean-tree.sh              # full gate (default ship lane)
#   ./scripts/archive-from-clean-tree.sh --skip-build # verify only (bundle already built)
#   ./scripts/archive-from-clean-tree.sh --sim-smoke  # also install on iOS simulator
#   ./scripts/archive-from-clean-tree.sh --fetch      # git fetch before behind-main check
#
# Env:
#   SHIP_LANE=/Users/dan/vettrack-ship   override ship worktree path
#   DEV_LANE=/Users/dan/vettrack         override dev lane (dirty-tree guard)
#   REPO=$SHIP_LANE                      passed through to verify/build/install scripts
#   CLERK_SECRET_KEY                     required for live Clerk gates (or Railway pull)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEV_LANE="${DEV_LANE:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SHIP_LANE="${SHIP_LANE:-$(cd "$DEV_LANE/.." && pwd)/vettrack-ship}"

SKIP_BUILD=false
SIM_SMOKE=false
DO_FETCH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=true; shift ;;
    --sim-smoke) SIM_SMOKE=true; shift ;;
    --fetch) DO_FETCH=true; shift ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1 (try --help)" >&2
      exit 2
      ;;
  esac
done

VERIFY_RESULT="NOT RUN"
BUILD_RESULT="NOT RUN"
BLOCKERS=()

report_status() {
  local tree_status branch sha dirty_count
  if git -C "$SHIP_LANE" rev-parse --git-dir >/dev/null 2>&1; then
    branch="$(git -C "$SHIP_LANE" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
    sha="$(git -C "$SHIP_LANE" rev-parse --short HEAD 2>/dev/null || echo "?")"
    dirty_count="$(git -C "$SHIP_LANE" status --porcelain | wc -l | tr -d ' ')"
    if [[ "$dirty_count" -eq 0 ]]; then tree_status="CLEAN"; else tree_status="DIRTY ($dirty_count files)"; fi
  else
    branch="?"; sha="?"; tree_status="MISSING"
  fi

  cat <<EOF

SHIP LANE CHECK
- Tree: $SHIP_LANE
- Branch: $branch @ $sha
- git status: $tree_status
- verify-resubmission: $VERIFY_RESULT
- build-native-shell: $BUILD_RESULT
- Blockers: $(if ((${#BLOCKERS[@]})); then printf '%s; ' "${BLOCKERS[@]}"; else echo none; fi | sed 's/; $//')
- Next step: $(if ((${#BLOCKERS[@]})); then echo "fix blockers above, then re-run this script"; else echo "open $SHIP_LANE/ios/App/App.xcworkspace → Product → Archive (increment build number if re-uploading)"; fi)
EOF
}

fail() {
  BLOCKERS+=("$1")
  echo "BLOCKER: $1" >&2
  report_status
  exit 1
}

echo "== VetTrack archive preflight (ship lane only) =="
echo "  dev lane:  $DEV_LANE"
echo "  ship lane: $SHIP_LANE"
echo

# --- ship worktree exists ---------------------------------------------------
if [[ ! -d "$SHIP_LANE" ]] || ! git -C "$SHIP_LANE" rev-parse --git-dir >/dev/null 2>&1; then
  fail "ship worktree missing — run: cd $DEV_LANE && git worktree add ../vettrack-ship main"
fi

# --- dev lane must not have uncommitted app source WIP ------------------------
dev_dirty="$(git -C "$DEV_LANE" status --porcelain 2>/dev/null || true)"
if [[ -n "$dev_dirty" ]]; then
  dev_count="$(printf '%s\n' "$dev_dirty" | sed '/^$/d' | wc -l | tr -d ' ')"
  fail "dev lane dirty ($dev_count files) — commit or stash before archive bundle"
fi

# --- ship lane must be clean --------------------------------------------------
ship_dirty="$(git -C "$SHIP_LANE" status --porcelain 2>/dev/null || true)"
if [[ -n "$ship_dirty" ]]; then
  ship_count="$(printf '%s\n' "$ship_dirty" | sed '/^$/d' | wc -l | tr -d ' ')"
  fail "ship lane dirty ($ship_count files) — reset or commit in vettrack-ship only"
fi

# --- ship on main -------------------------------------------------------------
ship_branch="$(git -C "$SHIP_LANE" rev-parse --abbrev-ref HEAD)"
if [[ "$ship_branch" != "main" ]]; then
  fail "ship lane on '$ship_branch' — checkout main before archive"
fi

# --- not behind origin/main ---------------------------------------------------
if $DO_FETCH; then
  git -C "$SHIP_LANE" fetch origin main >/dev/null 2>&1 || fail "git fetch origin main failed"
fi
if git -C "$SHIP_LANE" rev-parse origin/main >/dev/null 2>&1; then
  behind="$(git -C "$SHIP_LANE" log HEAD..origin/main --oneline 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$behind" -gt 0 ]]; then
    fail "ship lane behind origin/main by $behind commit(s) — cd $SHIP_LANE && git pull --ff-only origin main"
  fi
fi

# --- no debug instrumentation -----------------------------------------------
if rg -n "127\.0\.0\.1:7630|#region agent log" "$SHIP_LANE/src" "$SHIP_LANE/server" >/dev/null 2>&1; then
  fail "debug instrumentation found in ship src/server — remove before archive"
fi

# --- bundled-shell invariant --------------------------------------------------
if [[ -n "${CAPACITOR_SERVER_URL:-}" ]]; then
  fail "CAPACITOR_SERVER_URL is set — unset it (bundled shell only)"
fi

# --- verify -------------------------------------------------------------------
echo "== verify-resubmission.sh =="
if REPO="$SHIP_LANE" "$SHIP_LANE/scripts/verify-resubmission.sh"; then
  VERIFY_RESULT="PASS"
else
  VERIFY_RESULT="FAIL"
  fail "verify-resubmission.sh failed — fix gates before archive (RESUBMISSION_RUNBOOK §C/§G)"
fi

# --- build --------------------------------------------------------------------
if $SKIP_BUILD; then
  BUILD_RESULT="SKIPPED (--skip-build)"
  echo
  echo "== build-native-shell.sh skipped =="
else
  echo
  echo "== build-native-shell.sh =="
  if [[ ! -f "$SHIP_LANE/.env" ]]; then
    fail "ship lane missing .env — copy pk_live + VITE_API_ORIGIN from dev .env (gitignored)"
  fi
  if REPO="$SHIP_LANE" "$SHIP_LANE/scripts/build-native-shell.sh"; then
    BUILD_RESULT="PASS"
  else
    BUILD_RESULT="FAIL"
    fail "build-native-shell.sh failed"
  fi
fi

# --- optional sim smoke -------------------------------------------------------
if $SIM_SMOKE; then
  echo
  echo "== install-ios-sim.sh (sim smoke) =="
  REPO="$SHIP_LANE" "$SHIP_LANE/scripts/install-ios-sim.sh" --skip-build
fi

report_status
echo
echo "Ready for human archive: open $SHIP_LANE/ios/App/App.xcworkspace"
echo "  Product → Clean Build Folder → Archive → Distribute to App Store Connect"
echo "See RESUBMISSION_RUNBOOK.md §D–§E for upload + resubmit steps."
