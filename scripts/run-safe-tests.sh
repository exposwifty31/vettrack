#!/usr/bin/env bash
# CI-safe, non-destructive test runner for VetTrack (Section A).
# See TEST_AUDIT.md for full inventory and exclusions.
#
# Usage:
#   ./scripts/run-safe-tests.sh
#   PLAYWRIGHT_E2E=1 ./scripts/run-safe-tests.sh   # also run safe Playwright (API on :3001)
#
# Never runs: signup-flow, ui-smoke, example.spec, staging-* / staging-walkthrough, workday simulation, production/staging URLs.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

fail() { echo -e "${RED}✗${NC} $1" >&2; exit 1; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }

# Reject production or staging targets (local/CI only).
is_unsafe_url() {
  local value="${1:-}"
  local lower
  lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  [[ -z "$lower" ]] && return 1
  case "$lower" in
    *vettrack.uk*) return 0 ;;
    *vettrack-staging*) return 0 ;;
    *production.railway.app*) return 0 ;;
    *://*staging*.railway.app*) return 0 ;;
  esac
  return 1
}

guard_env_url() {
  local name="$1"
  local value="${!name:-}"
  if is_unsafe_url "$value"; then
    fail "${name} must not target production or staging (${value})"
  fi
}

guard_env_url TEST_BASE_URL
guard_env_url BASE_URL
guard_env_url PLAYWRIGHT_BASE_URL
guard_env_url API_URL
guard_env_url VITE_API_URL

if [[ "${DATABASE_URL:-}" == *"vettrack.uk"* ]] \
  || [[ "${DATABASE_URL:-}" == *"vettrack-staging"* ]] \
  || [[ "${DATABASE_URL:-}" == *"production"* ]]; then
  fail "DATABASE_URL must not target production or staging"
fi

if [[ "${STAGING_E2E_CONFIRM:-}" == "yes" ]]; then
  fail "STAGING_E2E_CONFIRM is set — use scripts/staging and staging workflows, not run-safe-tests.sh"
fi

echo "=== VetTrack safe test runner ==="

echo "--- TypeScript ---"
pnpm exec tsc --noEmit || fail "frontend tsc"
ok "frontend tsc"

pnpm exec tsc --noEmit --project tsconfig.server-check.json || fail "server tsc"
ok "server tsc"

echo "--- Vitest (default excludes from vite.config.ts) ---"
pnpm test || fail "vitest"
ok "vitest"

echo "--- Playwright list (CI allowlist sanity) ---"
PW_LIST="$(pnpm exec playwright test --project=chromium --list 2>&1)" || fail "playwright --list"
for required in e2e/flows/ pwa.spec.ts phase-9-drills.spec.ts; do
  printf '%s\n' "$PW_LIST" | grep -q "$required" || fail "playwright --list missing ${required}"
done
for forbidden in signup-flow.spec ui-smoke.spec example.spec staging- workday.spec; do
  if printf '%s\n' "$PW_LIST" | grep -q "$forbidden"; then
    fail "playwright --list must not include ${forbidden} (use explicit script / PW_SUITE)"
  fi
done
ok "playwright --list (CI allowlist only)"

if [[ "${PLAYWRIGHT_E2E:-}" == "1" ]]; then
  export TEST_BASE_URL="${TEST_BASE_URL:-http://127.0.0.1:3001}"
  export PLAYWRIGHT_E2E=true
  guard_env_url TEST_BASE_URL

  echo "--- Playwright safe E2E (requires API at ${TEST_BASE_URL}) ---"
  if ! curl -fsS "${TEST_BASE_URL}/api/healthz" > /dev/null 2>&1; then
    fail "API not reachable at ${TEST_BASE_URL}/api/healthz — start server (pnpm start:playwright-api) or unset PLAYWRIGHT_E2E"
  fi

  # Same allowlist as CI (playwright.config.ts PW_SUITE=ci)
  pnpm test:playwright:ci \
    || fail "playwright safe e2e"

  ok "playwright safe e2e"
else
  echo "(skip Playwright run — set PLAYWRIGHT_E2E=1 with API on :3001 to include safe browser tests)"
fi

echo ""
ok "All safe checks passed"
