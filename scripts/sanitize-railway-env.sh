#!/usr/bin/env bash
# Unset every RAILWAY_* variable except RAILWAY_TOKEN.
# Source before Railway CLI:  source scripts/sanitize-railway-env.sh
#
# Cloud Agent may inject stale secrets (RAILWAY_API_TOKEN, RAILWAY_TOKEN_STAGING,
# RAILWAY_SERVICE_STAGING, misnamed keys with spaces). Only RAILWAY_TOKEN should
# remain configured in Cursor → Cloud Agent secrets.

sanitize_railway_env() {
  while IFS= read -r key; do
    [[ -z "$key" || "$key" == "RAILWAY_TOKEN" ]] && continue
    unset "$key" 2>/dev/null || true
  done < <(env | awk -F= '/^RAILWAY_/ {print $1}')

  if command -v python3 >/dev/null 2>&1; then
    eval "$(python3 - <<'PY'
import os
import shlex

keep = {"RAILWAY_TOKEN"}
for key in list(os.environ):
    if key.startswith("RAILWAY_") and key not in keep:
        print(f"unset {shlex.quote(key)}")
PY
)"
  fi
}

if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  sanitize_railway_env
else
  sanitize_railway_env
  echo "Railway env (values hidden):"
  env | grep '^RAILWAY' | sed 's/=.*/=***/' || echo "(none)"
  if env | grep -q '^RAILWAY_TOKEN_STAGING '; then
    echo "⚠️  Misnamed secret still present (e.g. RAILWAY_TOKEN_STAGING 1). Delete it in Cursor → Cloud Agent secrets."
  fi
fi
