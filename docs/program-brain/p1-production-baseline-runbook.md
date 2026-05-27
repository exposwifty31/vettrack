# P1 — Production baseline runbook (env normalization only)

**Approved scope:** Deploy #496, unset pilot env vars, rebuild, verify. **No code deletions.**

## Prerequisites

- PR [#496](https://github.com/dboy3156/VetTrack/pull/496) merged to `main` (commit `6b7a5836` or later).
- Railway access to **production** service (not staging-only tokens).

## Railway variables (recommended)

Mainline builds **ignore** `VITE_PILOT_MODE=true` unless `ALLOW_EQUIPMENT_PILOT_MODE=true` (stale service vars no longer fail the Vite build). Runtime **ignores** `PILOT_MODE=true` the same way — full APIs stay mounted.

Still remove legacy vars to avoid confusion and so `/api/version` reflects a clean config:

1. In Railway → production service → **Variables**, delete or set to `false`:
   - `PILOT_MODE`
   - `VITE_PILOT_MODE`
   - (Do **not** set `ALLOW_EQUIPMENT_PILOT_MODE` on mainline production.)
2. **Then:** Trigger **Redeploy** (must run a fresh build — `VITE_*` is compile-time).
3. Wait for deployment **SUCCESS** and health checks.

After #496 + build override fix, redeploy should succeed even if `VITE_PILOT_MODE=true` is still listed — but **delete both vars** before calling P1 complete.

## Railway CLI (optional)

```bash
# Replace SERVICE_ID / PROJECT_ID from Railway dashboard
export RAILWAY_TOKEN="<production token>"

npx @railway/cli variables delete PILOT_MODE --service <production-service>
npx @railway/cli variables delete VITE_PILOT_MODE --service <production-service>

npx @railway/cli up --service <production-service> --detach
```

## Verification script

```bash
PROD=https://vettrack.uk

curl -sS "$PROD/api/version" | jq .
# Expect: pilotMode.backend == false, pilotMode.frontend == false, mismatch == false

curl -sSI -H 'Accept: application/json' "$PROD/api/appointments" | head -5
# Expect: HTTP/1.1 401 and content-type: application/json

curl -sSI -H 'Accept: application/json' "$PROD/api/medication-tasks" | head -5
curl -sSI -H 'Accept: application/json' "$PROD/api/billing" | head -5

curl -sfS -o /dev/null -w "healthz %{http_code}\n" "$PROD/api/healthz"
curl -sS "$PROD/api/health/startup" | jq .
```

Browser (signed in): `/home` full dashboard, `/dashboard`, `/appointments`, `/meds`, equipment checkout/return, top nav complete.

## Rollback

Railway → production → previous deployment **before** #496, only if startup cannot be recovered after unsetting `PILOT_MODE`.
