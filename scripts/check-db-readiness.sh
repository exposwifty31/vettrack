#!/bin/bash
#
# Post-deploy DB-readiness gate. Polls a readiness URL until it reports
# checks.db == "ok", or fails (exit 1) after a bounded number of attempts.
#
# Split out of deploy.sh so the logic is testable in isolation (stub `curl` on
# PATH — see tests/deploy-db-readiness.test.ts). Scoped to `db` on purpose:
# vapid/worker can flap transiently during a rolling deploy and must not fail an
# otherwise-healthy ship.
#
# Usage: check-db-readiness.sh <readiness-url>
# Tunables (env, defaulted for production; overridden by the test for speed):
#   READINESS_MAX_ATTEMPTS  (default 12)
#   READINESS_SLEEP_SECS    (default 10)
#   READINESS_CURL_TIMEOUT  (default 10)
set -u

readiness_url="${1:?readiness url required}"
max_attempts="${READINESS_MAX_ATTEMPTS:-12}"
sleep_secs="${READINESS_SLEEP_SECS:-10}"
curl_timeout="${READINESS_CURL_TIMEOUT:-10}"

# `-sS` (not `-f`): a degraded /api/health returns HTTP 503 with a JSON body; we
# want to read checks.db out of that body, not have curl abort on the status code.
for attempt in $(seq 1 "$max_attempts"); do
  db_status=$(curl -sS --max-time "$curl_timeout" "$readiness_url" 2>/dev/null | jq -r '.checks.db // empty' 2>/dev/null || true)
  if [ "$db_status" = "ok" ]; then
    echo "✅ DB readiness OK"
    exit 0
  fi
  echo "⏳ DB readiness: ${db_status:-unreachable} — waiting..."
  # Don't sleep after the final attempt — that only delays the failure exit.
  [ "$attempt" -eq "$max_attempts" ] || sleep "$sleep_secs"
done

echo "❌ Post-deploy DB readiness failed: $readiness_url reported checks.db != ok"
exit 1
