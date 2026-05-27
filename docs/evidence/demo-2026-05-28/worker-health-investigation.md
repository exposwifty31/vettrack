# Worker health investigation — FIX-2

**Date:** 2026-05-27  
**Symptom:** `GET /api/health` → `worker: fail` (other checks ok)

## Diagnosis

| Check | Finding |
|-------|---------|
| Health source | `server/routes/health.ts` reads Redis key `vettrack:worker:heartbeat` (TTL 120s, refresh every 30s) |
| Heartbeat writer (before fix) | Only `server/workers/notification.worker.ts` (`pnpm worker`) |
| Railway Worker service | Runs `pnpm start` → `startBackgroundSchedulers()` → `startJobRuntime()` (BullMQ). **Does not** run `notification.worker.ts` |
| Redis | `REDIS_URL` set on VetTrack + Worker; Redis plugin online |
| Production deploy | VetTrack + Worker on `18ea8777` |

**Root cause:** Operational mismatch — health check expected notification worker process, but production Worker service runs the API entrypoint with BullMQ job runtime only.

## Action taken

1. **Code (#508):** `server/lib/worker-heartbeat.ts` + `startWorkerHeartbeat()` from `startJobRuntime` when workers attach; notification worker shares helper.
2. **Railway:** `railway redeploy --service Worker` after merge (required for heartbeat fix to run in production).
3. **Not done:** New Railway services/plugins (per plan hard rule).

## Before / after `/api/health`

**Before (2026-05-27T19:32Z):**

```json
{ "status": "degraded", "checks": { "db": "ok", "clerk": "ok", "vapid": "ok", "worker": "fail" } }
```

**After (#508 deployed + Worker redeploy):** Re-run:

```bash
curl -sS https://vettrack.uk/api/health | jq .
```

Expected: `"worker": "ok"`.

## Non-impacting fallback

If Worker redeploy is delayed, push/inventory queues still process on Worker service logs show job-runtime active; only readiness label and ops dashboard semantics are degraded — document founder sign-off if demo proceeds before green health.
