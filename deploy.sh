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
required_vars=("DATABASE_URL" "REDIS_URL" "SESSION_SECRET" "CLERK_SECRET_KEY" "VITE_CLERK_PUBLISHABLE_KEY" "ALLOWED_ORIGIN")

for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "❌ Missing required environment variable: $var"
    exit 1
  fi
done

echo "✅ Required pre-flight checks passed"

# Check recommended environment variables (warn, don't block)
recommended_vars=("CLERK_WEBHOOK_SECRET" "DB_CONFIG_ENCRYPTION_KEY")

for var in "${recommended_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "⚠️  Recommended variable missing: $var (startup will warn)"
  fi
done

if [ "$CHECK_MODE" = false ]; then
  if [ -z "$RAILWAY_TOKEN" ]; then
    echo "❌ RAILWAY_TOKEN is not set — cannot deploy"
    exit 1
  fi
  if [ -z "$RAILWAY_SERVICE" ]; then
    echo "❌ RAILWAY_SERVICE is not set — cannot deploy to multi-service project"
    exit 1
  fi
  echo "🚀 Deploying to Railway (service: $RAILWAY_SERVICE)..."
  npx --yes @railway/cli@latest up --service "$RAILWAY_SERVICE" --detach
  echo "✅ Deploy triggered — Railway is building"
fi
