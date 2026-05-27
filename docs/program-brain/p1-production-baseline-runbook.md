# P1 — Production baseline runbook (env normalization only)

**Approved scope:** Deploy #496, unset pilot env vars, rebuild, verify. **No code deletions.**

## Prerequisites

- PR [#496](https://github.com/dboy3156/VetTrack/pull/496) merged to `main` (commit `6b7a5836` or later).
- Railway access to **production** service (not staging-only tokens).

## Critical order (avoid startup failure)

New code **refuses production startup** when `PILOT_MODE=true` unless `ALLOW_EQUIPMENT_PILOT_MODE=true`.

1. **First:** In Railway → production service → **Variables**, delete or set to `false`:
   - `PILOT_MODE`
   - `VITE_PILOT_MODE`
   - (Do **not** set `ALLOW_EQUIPMENT_PILOT_MODE` on mainline production.)
2. **Then:** Trigger **Redeploy** (must run a fresh build — `VITE_*` is compile-time).
3. Wait for deployment **SUCCESS** and health checks.

If you already deployed #496 while `PILOT_MODE=true` remains, the service may be crash-looping — unset `PILOT_MODE` immediately, then redeploy.

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
