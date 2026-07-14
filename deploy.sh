#!/bin/bash

set -e

# Parse arguments
CHECK_MODE=false
NO_COLOR=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --check)
      CHECK_MODE=true
      shift
      ;;
    --no-color)
      NO_COLOR=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Pre-flight checks
echo "Running deployment pre-flight checks..."

# Check required environment variables
required_vars=("DATABASE_URL" "REDIS_URL" "SESSION_SECRET" "CLERK_SECRET_KEY" "VITE_CLERK_PUBLISHABLE_KEY" "ALLOWED_ORIGIN" "DB_CONFIG_ENCRYPTION_KEY")

for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ Missing required environment variable: $var"
    exit 1
  fi
done

echo "✅ Required pre-flight checks passed"

# Equipment-only pilot mode is opt-in; mainline production must run full platform.
if [ "${PILOT_MODE}" = "true" ] && [ "${ALLOW_EQUIPMENT_PILOT_MODE}" != "true" ]; then
  echo "❌ PILOT_MODE=true without ALLOW_EQUIPMENT_PILOT_MODE=true — unset PILOT_MODE for mainline deploys"
  exit 1
fi
if [ "${VITE_PILOT_MODE}" = "true" ] && [ "${ALLOW_EQUIPMENT_PILOT_MODE}" != "true" ]; then
  echo "❌ VITE_PILOT_MODE=true without ALLOW_EQUIPMENT_PILOT_MODE=true — rebuild with VITE_PILOT_MODE=false"
  exit 1
fi

# Pilot-critical secrets — must match server/lib/envValidation.ts REQUIRED_IN_PRODUCTION
pilot_required_vars=("CLERK_WEBHOOK_SECRET" "DATA_INTEGRITY_HEALTH_TOKEN")

for var in "${pilot_required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ Required variable missing: $var (production startup will fail)"
    exit 1
  fi
done

# Pinned CLI — bump deliberately, never @latest (deploys must be reproducible).
RAILWAY_CLI_VERSION="${RAILWAY_CLI_VERSION:-5.26.0}"
DEPLOY_WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-600}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-https://vettrack.uk/api/healthz}"

railway_cli() {
  npx --yes "@railway/cli@${RAILWAY_CLI_VERSION}" "$@"
}

# `up --ci` exits when the build finishes; the deployment then still has to
# start (and pass its healthcheck). Poll until a terminal status.
wait_for_deploy() {
  local svc="$1"
  local deadline=$(( $(date +%s) + DEPLOY_WAIT_TIMEOUT ))
  local status
  while [ "$(date +%s)" -lt "$deadline" ]; do
    status=$(railway_cli deployment list --service "$svc" --json 2>/dev/null \
      | jq -r 'sort_by(.createdAt) | last | .status // empty' 2>/dev/null || true)
    case "$status" in
      SUCCESS)
        echo "✅ $svc deployment SUCCESS"
        return 0
        ;;
      FAILED|CRASHED|REMOVED|SKIPPED|NEEDS_APPROVAL)
        echo "❌ $svc deployment reached terminal status: $status"
        return 1
        ;;
      *)
        echo "⏳ $svc deployment status: ${status:-unknown} — waiting..."
        sleep 10
        ;;
    esac
  done
  echo "❌ Timed out after ${DEPLOY_WAIT_TIMEOUT}s waiting for $svc deployment"
  return 1
}

deploy_service() {
  local svc="$1"
  echo "🚀 Deploying to Railway (service: $svc)..."
  railway_cli up --service "$svc" --ci
  wait_for_deploy "$svc"
}

if [ "$CHECK_MODE" = false ]; then
  if [ -z "$RAILWAY_TOKEN" ]; then
    echo "❌ RAILWAY_TOKEN is not set — cannot deploy"
    exit 1
  fi
  if [ -z "$RAILWAY_SERVICE" ]; then
    echo "❌ RAILWAY_SERVICE is not set — cannot deploy to multi-service project"
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "❌ jq is required to verify deployment status"
    exit 1
  fi

  deploy_service "$RAILWAY_SERVICE"

  if [ -n "$HEALTHCHECK_URL" ]; then
    echo "🩺 Verifying $HEALTHCHECK_URL..."
    healthcheck_ok=false
    for _ in $(seq 1 12); do
      if curl -fsS --max-time 10 "$HEALTHCHECK_URL" >/dev/null 2>&1; then
        healthcheck_ok=true
        break
      fi
      sleep 10
    done
    if [ "$healthcheck_ok" != true ]; then
      echo "❌ Post-deploy healthcheck failed: $HEALTHCHECK_URL"
      exit 1
    fi
    echo "✅ Healthcheck OK"
  fi

  # Readiness gate: /api/healthz above proves the process is alive, not that the
  # runtime DB pool actually works. A broken pool (e.g. PGBOUNCER_URL pointing at a
  # host that doesn't resolve) still passes liveness and would otherwise ship "green"
  # — the 2026-07-14 prod outage. scripts/check-db-readiness.sh fails the deploy
  # unless /api/health reports checks.db == "ok".
  #
  # The default target is DERIVED from HEALTHCHECK_URL (the same deployment target,
  # not a hardcoded prod URL) by swapping the liveness path segment for the readiness
  # one. The default applies only when READINESS_URL is UNSET; export READINESS_URL=""
  # to disable the gate.
  READINESS_URL="${READINESS_URL-${HEALTHCHECK_URL%healthz}health}"
  if [ -n "$READINESS_URL" ]; then
    echo "🩺 Verifying DB readiness at $READINESS_URL (checks.db == ok)..."
    # set -e aborts the deploy if the gate exits non-zero.
    bash "$(dirname "$0")/scripts/check-db-readiness.sh" "$READINESS_URL"
  fi

  if [ -n "$RAILWAY_WORKER_SERVICE" ]; then
    deploy_service "$RAILWAY_WORKER_SERVICE"
  else
    echo "ℹ️ RAILWAY_WORKER_SERVICE unset — skipping worker deploy"
  fi

  echo "✅ Deploy complete"
fi
