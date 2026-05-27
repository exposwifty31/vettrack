#!/usr/bin/env bash
# Production API smoke — requires JSON responses (not SPA index.html fallback).
set -euo pipefail
PROD="${PROD:-https://vettrack.uk}"

probe() {
  local path="$1"
  local expect="${2:-401}"
  local headers body ct status
  headers=$(curl -sSI -H 'Accept: application/json' "${PROD}${path}" 2>/dev/null || true)
  status=$(echo "$headers" | head -1)
  ct=$(echo "$headers" | rg -i '^content-type:' | head -1 || true)
  printf "%-42s %s\n" "$path" "$status"
  if ! echo "$ct" | rg -qi 'application/json'; then
    echo "  FAIL: expected application/json, got: ${ct:-<none>}"
    return 1
  fi
  if ! echo "$status" | rg -q "$expect"; then
    echo "  WARN: expected HTTP $expect"
    return 1
  fi
  echo "  OK: $ct"
  return 0
}

echo "=== $PROD ==="
curl -sS "${PROD}/api/version" | jq -c '{gitCommit,pilotMode}' 2>/dev/null || true
echo ""

fail=0
for path in \
  /api/appointments \
  /api/medication-tasks \
  /api/billing \
  /api/tasks/dashboard \
  /api/tasks/me \
  /api/shift-handover/summary \
  /api/clinical/me/active; do
  probe "$path" 401 || fail=1
done

echo ""
echo "SPA traps (expect HTML 200 — do not treat as API pass):"
for path in /api/tasks /api/shift-handover /api/clinical-check-in; do
  ct=$(curl -sSI -H 'Accept: application/json' "${PROD}${path}" 2>/dev/null | rg -i '^content-type:' || true)
  printf "  %s → %s\n" "$path" "${ct:-unknown}"
done

exit "$fail"
